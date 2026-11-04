import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  createInstallationRegister, loadInstallationDevices, loadInstallationTestJob,
  registerInstallationPrinter, requestInstallationTestPrint, transitionInstallationTestPrint,
  type InstallerDevices,
} from '../data/installerDeviceRepository';
import type { PrintJob } from '../data/printerRepository';
import { bluetoothPrintingSupported, listPairedBluetoothPrinters, sendBluetoothPrintBytes,
  type BluetoothPrinterDevice } from '../printing/bluetoothPrinter';
import { buildEscPosPrintBytes } from '../printing/escPosReceipt';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props={appointmentId:string;businessName:string;branchName:string};

export default function ProcessEdgeInstallationDevicePanel({
  appointmentId,businessName,branchName,
}:Props){
  const {dark}=useSellerTrayAppearance();
  const epoch=useRef(0);
  const [devices,setDevices]=useState<InstallerDevices|null>(null);
  const [registerId,setRegisterId]=useState('');
  const [registerCode,setRegisterCode]=useState('MAIN');
  const [registerName,setRegisterName]=useState('Main register');
  const [paired,setPaired]=useState<BluetoothPrinterDevice[]>([]);
  const [deviceAddress,setDeviceAddress]=useState('');
  const [displayName,setDisplayName]=useState('');
  const [paperWidthMm,setPaperWidthMm]=useState<58|80>(58);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [job,setJob]=useState<PrintJob|null>(null);

  useEffect(()=>{
    const request=++epoch.current;
    setDevices(null);setRegisterId('');setPaired([]);setJob(null);
    setDeviceAddress('');setDisplayName('');setError(null);setNotice(null);
    void load(request);
    return()=>{epoch.current++};
  },[appointmentId]);

  async function load(requestEpoch:number=epoch.current){
    setBusy(current=>current??'loading');
    try{
      const next=await loadInstallationDevices(appointmentId);
      if(epoch.current!==requestEpoch)return;
      if(next.appointmentId!==appointmentId)
        throw new Error('Installation Branch response did not match the selected appointment.');
      setDevices(next);
      setRegisterId(current=>next.registers.some(r=>r.id===current)
        ?current:next.registers.find(r=>r.isDefault)?.id??next.registers[0]?.id??'');
    }catch(cause){
      if(epoch.current===requestEpoch)
        setError(cause instanceof Error?cause.message:'Unable to load installation devices.');
    }finally{
      if(epoch.current===requestEpoch)setBusy(null);
    }
  }

  async function createRegister(){
    if(busy||!registerCode.trim()||!registerName.trim())return;
    const request=epoch.current;setBusy('register');setError(null);setNotice(null);
    try{
      const saved=await createInstallationRegister({
        appointmentId,code:registerCode,name:registerName,
      });
      if(epoch.current!==request)return;
      await load(request);
      if(epoch.current!==request)return;
      setRegisterId(saved.registerId);
      setNotice('Branch register prepared. This does not activate selling.');
    }catch(cause){
      if(epoch.current===request)setError(cause instanceof Error?cause.message:'Unable to prepare register.');
    }finally{if(epoch.current===request)setBusy(null);}
  }

  async function discover(){
    if(busy)return;
    const request=epoch.current;setBusy('pairing');setError(null);setNotice(null);
    try{
      const rows=await listPairedBluetoothPrinters();
      if(epoch.current!==request)return;
      setPaired(rows);
      if(!rows.length)setNotice('No paired printers found. Pair the Bluetooth printer in Android settings first.');
    }catch(cause){
      if(epoch.current===request)setError(cause instanceof Error?cause.message:'Unable to find paired devices.');
    }finally{if(epoch.current===request)setBusy(null);}
  }

  async function savePrinter(){
    if(busy||!registerId||!deviceAddress||!displayName.trim())return;
    const request=epoch.current;setBusy('printer');setError(null);setNotice(null);
    try{
      const result=await registerInstallationPrinter({
        appointmentId,registerId,displayName,hardwareIdentifier:deviceAddress,paperWidthMm,
      });
      if(epoch.current!==request)return;
      await load(request);
      if(epoch.current!==request)return;
      setDeviceAddress('');setDisplayName('');
      setNotice('Bluetooth printer registered. Run a physical test print before setup completion.');
      // Only the chosen registered printer is eligible for its test job.
      if(!result.printerId)throw new Error('Printer registration was not confirmed.');
    }catch(cause){
      if(epoch.current===request)setError(cause instanceof Error?cause.message:'Unable to register printer.');
    }finally{if(epoch.current===request)setBusy(null);}
  }

  async function printTest(printerId:string){
    if(busy||job?.status==='printing')return;
    const request=epoch.current;setBusy('printing');setError(null);setNotice(null);
    let attempt:PrintJob|null=null;
    let sent=false;
    try{
      attempt=await requestInstallationTestPrint(appointmentId,printerId);
      if(epoch.current!==request)return;
      setJob(attempt);
      if(attempt.status==='printed'){
        setNotice('A successful physical test is already recorded. Request a new test only if required.');
        return;
      }
      if(attempt.status!=='requested'){
        throw new Error('This print attempt has already started. Check its recorded status before trying another.');
      }
      await transitionInstallationTestPrint(appointmentId,attempt.jobId,'printing');
      const bytes=buildEscPosPrintBytes(attempt.contentSnapshot,attempt.paperWidthMm);
      await sendBluetoothPrintBytes(attempt.hardwareIdentifier,bytes);
      sent=true;
      await transitionInstallationTestPrint(appointmentId,attempt.jobId,'printed');
      if(epoch.current!==request)return;
      const confirmed=await loadInstallationTestJob(appointmentId,attempt.jobId);
      if(epoch.current!==request)return;
      setJob(confirmed);
      if(confirmed.status!=='printed')
        throw new Error('Physical printing completed, but the server has not confirmed the print result.');
      setNotice('Test receipt printed and confirmed. ProcessEdge can now complete the equipment handover checks.');
    }catch(cause){
      if(attempt && !sent && attempt.status==='requested'){
        try{
          await transitionInstallationTestPrint(
            appointmentId,attempt.jobId,'failed',
            cause instanceof Error?cause.message:'Bluetooth test print failed',
          );
        }catch{/* Preserve the original failure and avoid fabricating a successful print. */}
      }
      if(epoch.current===request)setError(
        (cause instanceof Error?cause.message:'Printer test was not confirmed.')
        +(sent?' The receipt may have printed; check job status before trying another test.':'')
      );
    }finally{
      if(epoch.current===request)setBusy(null);
    }
  }

  async function checkJob(){
    if(busy||!job)return;
    const request=epoch.current;setBusy('status');setError(null);
    try{
      const current=await loadInstallationTestJob(appointmentId,job.jobId);
      if(epoch.current!==request)return;
      setJob(current);
      setNotice(current.status==='printed'?'Successful physical test is recorded.':
        current.status==='printing'?'Print confirmation is still pending. Do not print twice.':
        current.status==='failed'?'The test was unsuccessful. Choose a new print attempt.':
        'Test requested. Printing has not been confirmed.');
    }catch(cause){
      if(epoch.current===request)setError(cause instanceof Error?cause.message:'Unable to confirm print status.');
    }finally{if(epoch.current===request)setBusy(null);}
  }

  const activeRegisters=devices?.registers.filter(r=>r.isActive)??[];
  const printers=devices?.printers.filter(p=>p.registerId===registerId&&p.isActive)??[];
  const supported=bluetoothPrintingSupported();
  return <View style={[styles.panel,dark&&styles.panelDark]}>
    <Text style={[styles.title,dark&&styles.light]}>Prepare {branchName}</Text>
    <Text style={[styles.copy,dark&&styles.subtle]}>
      {businessName} · Setup only. Register and Bluetooth tests are limited to this assigned appointment.
      These actions do not activate the Branch or enable sales.
    </Text>
    {error?<Text style={styles.error}>{error}</Text>:null}
    {notice?<Text style={styles.success}>{notice}</Text>:null}
    {busy?<ActivityIndicator color="#12B76A" />:null}

    <Text style={[styles.heading,dark&&styles.light]}>1. Branch register</Text>
    {activeRegisters.length?<View style={styles.chips}>{activeRegisters.map(r=>
      <Pressable key={r.id} disabled={Boolean(busy)}
        style={[styles.chip,r.id===registerId&&styles.chipSelected]}
        onPress={()=>{setRegisterId(r.id);setJob(null);setDeviceAddress('');setDisplayName('')}}>
        <Text style={styles.chipText}>{r.name}{r.isDefault?' · Default':''}</Text>
      </Pressable>)}</View>:<Text style={[styles.copy,dark&&styles.subtle]}>
      No active register has been prepared for this Branch.
    </Text>}
    <Text style={[styles.copy,dark&&styles.subtle]}>Create an additional register only when it is needed.</Text>
    <TextInput accessibilityLabel="Register code" placeholder="Code, e.g. MAIN"
      value={registerCode} onChangeText={setRegisterCode} maxLength={40}
      style={styles.input} autoCapitalize="characters" />
    <TextInput accessibilityLabel="Register name" placeholder="Register name"
      value={registerName} onChangeText={setRegisterName} maxLength={120} style={styles.input}/>
    <Pressable style={styles.action} disabled={Boolean(busy)}
      onPress={()=>void createRegister()}><Text style={styles.actionText}>Create Branch register</Text></Pressable>

    <Text style={[styles.heading,dark&&styles.light]}>2. Pair and register printer</Text>
    {!supported?<Text style={styles.error}>Bluetooth printing requires the installed Android SellerTray app.</Text>:null}
    {registerId&&supported?<><Pressable style={styles.secondary} disabled={Boolean(busy)}
      onPress={()=>void discover()}><Text style={styles.secondaryText}>Show paired Bluetooth printers</Text></Pressable>
      <View style={styles.chips}>{paired.map(device=><Pressable
        key={device.address} disabled={Boolean(busy)} style={[styles.chip,deviceAddress===device.address&&styles.chipSelected]}
        onPress={()=>{setDeviceAddress(device.address);setDisplayName(device.name)}}>
        <Text style={styles.chipText}>{device.name} · {device.address}</Text>
      </Pressable>)}</View>
      {deviceAddress?<Text style={[styles.copy,dark&&styles.subtle]}>Selected: {deviceAddress}</Text>:null}
      <TextInput accessibilityLabel="Printer display name" placeholder="Printer display name"
        style={styles.input} maxLength={120} value={displayName} onChangeText={setDisplayName}/>
      <View style={styles.chips}>{([58,80]as const).map(width=><Pressable
        key={width} style={[styles.chip,width===paperWidthMm&&styles.chipSelected]}
        onPress={()=>setPaperWidthMm(width)} disabled={Boolean(busy)}>
        <Text style={styles.chipText}>{width} mm</Text>
      </Pressable>)}</View>
      <Pressable style={styles.action} disabled={Boolean(busy)||!deviceAddress||!displayName.trim()}
        onPress={()=>void savePrinter()}>
        <Text style={styles.actionText}>Register paired printer</Text>
      </Pressable></>:null}

    <Text style={[styles.heading,dark&&styles.light]}>3. Print a physical test receipt</Text>
    {!printers.length?<Text style={[styles.copy,dark&&styles.subtle]}>
      Register a printer first, then print from the SellerTray app to verify the device.
    </Text>:printers.map(printer=><View key={printer.id} style={styles.deviceRow}>
      <Text style={[styles.copy,dark&&styles.subtle]}>{printer.displayName} · {printer.paperWidthMm} mm</Text>
      <Pressable style={styles.secondary} disabled={Boolean(busy)||!supported||job?.status==='printing'}
        onPress={()=>void printTest(printer.id)}>
        <Text style={styles.secondaryText}>Test print</Text>
      </Pressable>
    </View>)}
    {job?<View style={styles.jobCard}>
      <Text style={[styles.copy,dark&&styles.subtle]}>Test job: {job.status}</Text>
      <Pressable style={styles.secondary} disabled={Boolean(busy)}
        onPress={()=>void checkJob()}>
        <Text style={styles.secondaryText}>Check recorded print status</Text>
      </Pressable>
    </View>:null}
    <Pressable style={styles.secondary} disabled={Boolean(busy)}
      onPress={()=>void load()}><Text style={styles.secondaryText}>Refresh Branch devices</Text></Pressable>
    <Text style={[styles.note,dark&&styles.subtle]}>
      Setup readiness is confirmed through the existing ProcessEdge handover and activation checks;
      this screen cannot bypass payment, agreement acceptance or other activation requirements.
    </Text>
  </View>;
}

const styles=StyleSheet.create({
  panel:{padding:14,borderWidth:1,borderColor:'#D0D5DD',borderRadius:12,backgroundColor:'#F8FAFC',gap:11},
  panelDark:{backgroundColor:'#102A43',borderColor:'#475467'},
  title:{color:'#102A43',fontSize:18,fontWeight:'800'},
  heading:{color:'#102A43',fontSize:15,fontWeight:'800',marginTop:8},
  copy:{color:'#475467',fontSize:13,lineHeight:19},
  note:{color:'#667085',fontSize:12,lineHeight:17},
  light:{color:'#F8FAFC'},subtle:{color:'#CBD5E1'},
  input:{borderWidth:1,borderColor:'#D0D5DD',backgroundColor:'#FFFFFF',
    color:'#102A43',borderRadius:9,padding:11,fontSize:15},
  action:{backgroundColor:'#12B76A',padding:13,alignItems:'center',borderRadius:9},
  actionText:{color:'#102A43',fontWeight:'800'},
  secondary:{borderWidth:1,borderColor:'#12B76A',padding:11,borderRadius:9,alignItems:'center'},
  secondaryText:{color:'#087F4D',fontWeight:'700'},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:7},
  chip:{borderWidth:1,borderColor:'#D0D5DD',padding:9,borderRadius:9,maxWidth:'100%'},
  chipSelected:{borderColor:'#12B76A',backgroundColor:'#D9FBE8'},
  chipText:{color:'#102A43',fontWeight:'600',fontSize:12},
  deviceRow:{gap:8,padding:10,borderWidth:1,borderColor:'#D0D5DD',borderRadius:9},
  jobCard:{padding:10,borderRadius:9,borderWidth:1,borderColor:'#D0D5DD',gap:8},
  error:{color:'#B42318',fontSize:13},
  success:{color:'#027A48',fontSize:13},
});
