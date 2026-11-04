import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { loadCashRegisters, type CashRegister, type CashShift } from '../data/cashShiftRepository';
import { supabase } from '../lib/supabase';
import type { CommerceBranch } from '../data/commerceRepository';
import { loadPrinterReceiptSettings, loadPrinters, loadPrintingCapabilities, requestPrintJob, savePrinter, savePrinterReceiptSettings, type PrintingCapabilities, type ReceiptCopyDefinition, type ReceiptCopyType, type SellerTrayPrinter } from '../data/printerRepository';
import { bluetoothPrintingSupported, listPairedBluetoothPrinters, type BluetoothPrinterDevice } from '../printing/bluetoothPrinter';
import { executePreparedPrintJob } from '../printing/printExecutor';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props={tenantId:string;branch:CommerceBranch;activeShift:CashShift|null;onClose:()=>void;installerAppointmentId?:string|null};
type DeviceSetupBranch={id:string;name:string;isActive:boolean};
const NO_CAPABILITIES:PrintingCapabilities={canPrintReceipt:false,canManageDevices:false};
const COPY_TYPES:{type:ReceiptCopyType;label:string}[]=[{type:'customer',label:'Customer Copy'},{type:'store',label:'Store Copy'},{type:'audit',label:'Audit Copy'},{type:'accounts',label:'Accounts Copy'},{type:'dispatch',label:'Dispatch Copy'},{type:'production',label:'Production Copy'},{type:'custom',label:'Custom'}];
const DEFAULT_COPY:ReceiptCopyDefinition={type:'customer',label:'Customer Copy',sortOrder:1};

export function PrinterWorkspace({tenantId,branch,activeShift,onClose,installerAppointmentId}:Props){
 const appearance=useSellerTrayAppearance();const dark=appearance.dark;
 const deviceEditEpoch=useRef(0);
 const[deviceBranchId,setDeviceBranchId]=useState(branch.id);
 const[deviceBranches,setDeviceBranches]=useState<DeviceSetupBranch[]>([{id:branch.id,name:branch.name,isActive:true}]);
 const deviceBranch=deviceBranches.find(row=>row.id===deviceBranchId)??deviceBranches[0];
 const[registers,setRegisters]=useState<CashRegister[]>([]);const[registerReloadKey,setRegisterReloadKey]=useState(0);const[registerId,setRegisterId]=useState(activeShift?.registerId??'');const[printers,setPrinters]=useState<SellerTrayPrinter[]>([]);const[capabilities,setCapabilities]=useState<PrintingCapabilities>(NO_CAPABILITIES);const[pairedDevices,setPairedDevices]=useState<BluetoothPrinterDevice[]>([]);const[loading,setLoading]=useState(true);const[discovering,setDiscovering]=useState(false);const[saving,setSaving]=useState(false);const[printingId,setPrintingId]=useState<string|null>(null);const[error,setError]=useState<string|null>(null);const[notice,setNotice]=useState<string|null>(null);const[editingId,setEditingId]=useState<string|null>(null);const[deviceAddress,setDeviceAddress]=useState('');const[displayName,setDisplayName]=useState('');const[paperWidthMm,setPaperWidthMm]=useState<58|80>(58);const[isDefault,setIsDefault]=useState(true);const[isActive,setIsActive]=useState(true);const[copies,setCopies]=useState<ReceiptCopyDefinition[]>([DEFAULT_COPY]);const[merchantFooter,setMerchantFooter]=useState('');
 const [setupRegisterCode,setSetupRegisterCode]=useState('');
 const [setupRegisterName,setSetupRegisterName]=useState('');
 // Preserve one command key when a network response is lost. Different facts
 // always receive a different key; retries can never create another register.
 const registerCommand=useRef<{facts:string;key:string}|null>(null);
 const printerCommand=useRef<{facts:string;key:string}|null>(null);
 const receiptCommand=useRef<{facts:string;key:string}|null>(null);
 const selectedRegister=useMemo(()=>registers.find(r=>r.id===registerId)??null,[registerId,registers]);
  useEffect(()=>{
    let mounted=true;
    deviceEditEpoch.current+=1;
    setDeviceBranchId(branch.id);
    setRegisterId('');setPrinters([]);setEditingId(null);
    setDeviceAddress('');setDisplayName('');setPaperWidthMm(58);
    setIsDefault(true);setIsActive(true);setCopies([DEFAULT_COPY]);setMerchantFooter('');
    setDeviceBranches([{id:branch.id,name:branch.name,isActive:true}]);
    // ProcessEdge staff never enumerate merchant-managed Branches.
    if(installerAppointmentId)return()=>{mounted=false};
    // Management-only Branches never enter the POS switcher.
    void supabase.rpc('get_sellertray_manageable_branches',{p_tenant_id:tenantId}).then(({data,error})=>{
      if(!mounted||error||!Array.isArray(data))return;
      const rows=data.map((value:unknown)=>{
        const item=(value??{}) as Record<string,unknown>;
        return {id:String(item.id??''),name:String(item.name??'Branch'),isActive:item.is_active===true};
      }).filter((item:DeviceSetupBranch)=>item.id);
      if(rows.length)setDeviceBranches(rows);
    });
    return()=>{mounted=false};
  },[tenantId,branch.id,branch.name,installerAppointmentId]);
  function chooseDeviceBranch(nextId:string){
    if(nextId===deviceBranchId||saving||printingId!==null)return;
    deviceEditEpoch.current+=1;
    setDeviceBranchId(nextId);setRegisterId('');setPrinters([]);setEditingId(null);
    setDeviceAddress('');setDisplayName('');setPaperWidthMm(58);
    setIsDefault(true);setIsActive(true);setCopies([DEFAULT_COPY]);setMerchantFooter('');
    setPairedDevices([]);setError(null);setNotice(null);
  }
 useEffect(()=>{let mounted=true;setLoading(true);setError(null);void Promise.all([loadCashRegisters(tenantId,deviceBranchId),loadPrintingCapabilities(tenantId,deviceBranchId)]).then(([r,c])=>{if(!mounted)return;setRegisters(r);setCapabilities(c);setRegisterId(current=>r.some(x=>x.id===current)?current:activeShift&&r.some(x=>x.id===activeShift.registerId)?activeShift.registerId:r.find(x=>x.isDefault)?.id??r[0]?.id??'');}).catch(e=>mounted&&setError(e instanceof Error?e.message:'Unable to load printer settings.')).finally(()=>mounted&&setLoading(false));return()=>{mounted=false};},[tenantId,deviceBranchId,activeShift?.registerId,registerReloadKey]);
 useEffect(()=>{if(!registerId){setPrinters([]);return;}let mounted=true;void loadPrinters(tenantId,deviceBranchId,registerId).then(rows=>mounted&&setPrinters(rows)).catch(e=>mounted&&setError(e instanceof Error?e.message:'Unable to load printers.'));return()=>{mounted=false};},[tenantId,deviceBranchId,registerId]);
 async function refreshPrinters(tenantAtRequest:string,branchAtRequest:string,registerAtRequest:string,epochAtRequest:number){
  const rows=await loadPrinters(tenantAtRequest,branchAtRequest,registerAtRequest);
  // A delayed save may not replace another setup Branch/register's printer list.
  if(deviceEditEpoch.current===epochAtRequest)setPrinters(rows);
 }
 async function loadPaired(){setDiscovering(true);setError(null);setNotice(null);try{const d=await listPairedBluetoothPrinters();setPairedDevices(d);if(!d.length)setNotice('No paired Bluetooth devices were found. Pair the printer in Android Bluetooth settings first.');}catch(e){setError(e instanceof Error?e.message:'Unable to read paired Bluetooth devices.');}finally{setDiscovering(false)}}
 function selectDevice(d:BluetoothPrinterDevice){setDeviceAddress(d.address);if(!displayName.trim())setDisplayName(d.name);setNotice(null)}
 async function editPrinter(p:SellerTrayPrinter){
  const editEpoch=++deviceEditEpoch.current;
  setEditingId(p.id);setDeviceAddress(p.hardwareIdentifier);setDisplayName(p.displayName);
  setPaperWidthMm(p.paperWidthMm);setIsDefault(p.isDefault);setIsActive(p.isActive);
  setCopies([DEFAULT_COPY]);setMerchantFooter('');setError(null);setNotice(null);
  try{
    const settings=await loadPrinterReceiptSettings(tenantId,p.id);
    if(deviceEditEpoch.current!==editEpoch)return;
    setCopies(settings.copyDefinitions);setMerchantFooter(settings.merchantFooter??'');
  }catch(e){
    if(deviceEditEpoch.current===editEpoch)setError(e instanceof Error?e.message:'Unable to load receipt settings.');
  }
 }
 function resetForm(isFirstPrinter:boolean=printers.length===0){deviceEditEpoch.current+=1;setEditingId(null);setDeviceAddress('');setDisplayName('');setPaperWidthMm(58);setIsDefault(isFirstPrinter);setIsActive(true);setCopies([DEFAULT_COPY]);setMerchantFooter('')}
 function addCopy(){if(copies.length>=8)return;setCopies(current=>[...current,{type:'store',label:'Store Copy',sortOrder:current.length+1}])}
 function removeCopy(index:number){if(copies.length===1)return;setCopies(current=>current.filter((_,i)=>i!==index).map((c,i)=>({...c,sortOrder:i+1})))}
 function changeCopyType(index:number,type:ReceiptCopyType){const standard=COPY_TYPES.find(x=>x.type===type)?.label??'Custom';setCopies(current=>current.map((c,i)=>i===index?{...c,type,label:type==='custom'?(c.type==='custom'?c.label:''):standard}:c))}
 function changeCopyLabel(index:number,label:string){setCopies(current=>current.map((c,i)=>i===index?{...c,label}:c))}
 async function persistPrinter(){
  if(!registerId||saving)return;
  const saveEpoch=deviceEditEpoch.current;
  const saveTenant=tenantId,saveBranch=deviceBranchId,saveRegister=registerId;
  const printerFacts=JSON.stringify({
    tenantId:saveTenant,branchId:saveBranch,registerId:saveRegister,
    appointmentId:installerAppointmentId,printerId:editingId,
    displayName:displayName.trim(),hardwareIdentifier:deviceAddress.trim(),
    paperWidthMm,isDefault,isActive,
  });
  if(installerAppointmentId&&printerCommand.current?.facts!==printerFacts){
    printerCommand.current={
      facts:printerFacts,
      key:`installer-printer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,14)}`,
    };
  }
  setSaving(true);setError(null);setNotice(null);
  const printerStorageKey = installerAppointmentId
    ? `sellertray.installerPrinter.v1:${saveTenant}:${saveBranch}:${installerAppointmentId}`
    : null;
  try{
   if(printerStorageKey&&printerCommand.current){
     printerCommand.current.key=await durableInstallerCommand(
       printerStorageKey,printerFacts,printerCommand.current.key,
     );
   }
   const p=await savePrinter({
     tenantId:saveTenant,printerId:editingId,branchId:saveBranch,registerId:saveRegister,
     displayName,hardwareIdentifier:deviceAddress,paperWidthMm,isDefault,isActive,
     installerAppointmentId,
     installerRequestKey:installerAppointmentId?printerCommand.current?.key:null,
   });
   const receiptFacts=JSON.stringify({
     tenantId:saveTenant,printerId:p.id,appointmentId:installerAppointmentId,
     copyDefinitions:copies,merchantFooter:merchantFooter.trim(),
   });
   if(installerAppointmentId&&receiptCommand.current?.facts!==receiptFacts){
     receiptCommand.current={
       facts:receiptFacts,
       key:`installer-copies-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,14)}`,
     };
   }
   const receiptStorageKey = installerAppointmentId
     ? `sellertray.installerCopies.v1:${saveTenant}:${installerAppointmentId}:${p.id}`
     : null;
   if(receiptStorageKey&&receiptCommand.current){
     receiptCommand.current.key=await durableInstallerCommand(
       receiptStorageKey,receiptFacts,receiptCommand.current.key,
     );
   }
   await savePrinterReceiptSettings({
     tenantId:saveTenant,printerId:p.id,copyDefinitions:copies,merchantFooter,
     installerAppointmentId,
     installerRequestKey:installerAppointmentId?receiptCommand.current?.key:null,
   });
   printerCommand.current=null;receiptCommand.current=null;
   // Clear keys only once the entire printer + receipt profile workflow has
   // succeeded; a lost response between the two writes can safely replay.
   if(printerStorageKey)await AsyncStorage.removeItem(printerStorageKey).catch(()=>{});
   if(receiptStorageKey)await AsyncStorage.removeItem(receiptStorageKey).catch(()=>{});
   if(deviceEditEpoch.current!==saveEpoch)return;
   await refreshPrinters(saveTenant,saveBranch,saveRegister,saveEpoch);
   if(deviceEditEpoch.current!==saveEpoch)return;
   resetForm();setNotice('Printer and receipt settings saved.');
  }catch(e){
   if(deviceEditEpoch.current===saveEpoch)setError(e instanceof Error?e.message:'Unable to save this printer.');
  }finally{setSaving(false)}
 }
 async function createInstallationRegister(){
  if(!installerAppointmentId||saving||!setupRegisterCode.trim()||!setupRegisterName.trim())return;
  const epoch=deviceEditEpoch.current;
  const code=setupRegisterCode.trim().toUpperCase();
  const name=setupRegisterName.trim();
  const facts=JSON.stringify({tenantId,branchId:deviceBranchId,appointmentId:installerAppointmentId,code,name});
  if(!registerCommand.current||registerCommand.current.facts!==facts) {
    registerCommand.current={facts,key:`installer-register-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`};
  }
  const storedCommandKey=`sellertray.installerRegister.v1:${tenantId}:${deviceBranchId}:${installerAppointmentId}`;
  setSaving(true);setError(null);setNotice(null);
  try {
    const requestKey=await durableInstallerCommand(
      storedCommandKey,facts,registerCommand.current.key,
    );
    registerCommand.current.key=requestKey;
    const {error:requestError}=await supabase.rpc('save_sellertray_installer_register',{
      p_tenant_id:tenantId,p_branch_id:deviceBranchId,
      p_appointment_id:installerAppointmentId,
      p_code:code,p_name:name,p_request_key:requestKey,
    });
    if(requestError)throw requestError;
    if(registerCommand.current?.key===requestKey)registerCommand.current=null;
    await AsyncStorage.removeItem(storedCommandKey).catch(()=>{});
    if(deviceEditEpoch.current!==epoch)return;
    setSetupRegisterCode('');setSetupRegisterName('');
    setRegisterReloadKey(value=>value+1);
    setNotice('Branch setup register created. You can now register and test the printer.');
  }catch(cause){
    if(deviceEditEpoch.current===epoch)setError(cause instanceof Error?cause.message:'Unable to prepare this register.');
  }finally{setSaving(false)}
 }
 async function testPrinter(p:SellerTrayPrinter){
  if(saving||printingId!==null)return;
  const testEpoch=deviceEditEpoch.current;
  const testTenant=tenantId;
  setPrintingId(p.id);setError(null);setNotice(null);
  try{
    const job=await requestPrintJob({
      tenantId:testTenant,printerId:p.id,jobType:'test',installerAppointmentId,
    });
    await executePreparedPrintJob(testTenant,job,installerAppointmentId);
    if(deviceEditEpoch.current===testEpoch)setNotice(`Test receipt printed on ${p.displayName}.`);
  }catch(e){
    if(deviceEditEpoch.current===testEpoch)setError(e instanceof Error?e.message:'Test print failed.');
  }finally{setPrintingId(null)}
 }
 return <View style={styles.stack}>
  <Pressable onPress={onClose} style={styles.backRow}><Ionicons name="chevron-back" size={20} color={dark?theme.colors.cloud:theme.colors.navy}/><Text style={[styles.backText,dark&&darkStyles.titleText]}>{installerAppointmentId?'My Installations':'More'}</Text></Pressable>
  <View style={styles.heading}><Text style={[styles.eyebrow,dark&&darkStyles.bodyText]}>DEVICES & PRINTERS</Text><Text style={[styles.title,dark&&darkStyles.titleText]}>Receipt printers</Text><Text style={[styles.subtitle,dark&&darkStyles.bodyText]}>Connect a Bluetooth thermal printer, choose receipt copies and test printing for this branch.</Text></View>
  {!installerAppointmentId&&deviceBranches.length>1?<View style={styles.section}>
    <Text style={[styles.sectionLabel,dark&&darkStyles.bodyText]}>PRINTER SETUP BRANCH</Text>
    <View style={styles.chipRow}>{deviceBranches.map(b=><Pressable key={b.id}
      accessibilityRole="button" disabled={saving||printingId!==null} onPress={()=>chooseDeviceBranch(b.id)}
      style={[styles.chip, dark && darkStyles.chip, b.id===deviceBranchId&&styles.chipActive, dark && b.id===deviceBranchId && darkStyles.chipActive]}>
      <Text style={[styles.chipText, dark && darkStyles.chipText, b.id===deviceBranchId&&styles.chipTextActive, dark && b.id===deviceBranchId && darkStyles.chipTextActive]}>{b.name}{b.isActive?'':' · Setup only'}</Text>
    </Pressable>)}</View>
   </View>:null}
   {deviceBranch?.isActive===false?<View style={[styles.infoCard,dark&&darkStyles.card]}>
    <Ionicons name="information-circle-outline" size={21} color={theme.colors.greenDark}/>
    <Text style={[styles.infoText,dark&&darkStyles.bodyText]}>This Branch is not active for sales. Device preparation and Bluetooth tests are available only if its setup was purchased and you have permission.</Text>
   </View>:null}
   {!bluetoothPrintingSupported()?<View style={[styles.infoCard,dark&&darkStyles.card]}><Ionicons name="information-circle-outline" size={21} color={theme.colors.greenDark}/><Text style={[styles.infoText,dark&&darkStyles.bodyText]}>Bluetooth printing requires the installed SellerTray Android build.</Text></View>:null}
  {error?<MessageCard tone="error" text={error} dark={dark}/>:null}{notice?<MessageCard tone="success" text={notice} dark={dark}/>:null}
  {loading?<View style={[styles.emptyCard,dark&&darkStyles.card]}><ActivityIndicator/><Text style={[styles.muted,dark&&darkStyles.bodyText]}>Loading printer settings…</Text></View>:null}
  {!loading&&!registers.length&&!installerAppointmentId?<View style={[styles.infoCard,dark&&darkStyles.card]}>
   <Ionicons name="information-circle-outline" size={21} color={theme.colors.greenDark}/>
   <View style={styles.flexOne}>
    <Text style={[styles.emptyTitle,dark&&darkStyles.titleText]}>Create a register before pairing a printer</Text>
    <Text style={[styles.infoText,dark&&darkStyles.bodyText]}>The Business Owner or Manager can create a register in SellerTray Merchant Web under Devices & Printers. You can then connect and test the Bluetooth printer here before activation.</Text>
    <Pressable accessibilityRole="button" onPress={()=>setRegisterReloadKey(key=>key+1)} style={[styles.outlineButton, dark && darkStyles.outlineButton]}>
     <Text style={[styles.outlineButtonText, dark && darkStyles.titleText]}>Refresh registers</Text>
    </Pressable>
   </View>
  </View>:null}
  {installerAppointmentId&&!loading?<View style={[styles.setupCard,dark&&darkStyles.card]}>
    <Text style={[styles.sectionTitle,dark&&darkStyles.titleText]}>Create Branch setup register</Text>
    <Text style={[styles.helper,dark&&darkStyles.bodyText]}>Registers are prepared only for the currently assigned installation. No cashier shift or sale is opened.</Text>
    <Field label="Register code" value={setupRegisterCode} onChange={setSetupRegisterCode} dark={dark} placeholder="REG-01"/>
    <Field label="Register name" value={setupRegisterName} onChange={setSetupRegisterName} dark={dark} placeholder="Front Counter"/>
    <Pressable accessibilityRole="button" disabled={saving||!setupRegisterCode.trim()||!setupRegisterName.trim()} onPress={()=>void createInstallationRegister()}
      style={[styles.saveButton,(saving||!setupRegisterCode.trim()||!setupRegisterName.trim())&&styles.disabled]}>
      <Text style={styles.saveButtonText}>{saving?'Saving register…':'Create setup register'}</Text>
    </Pressable>
  </View>:null}
  {registers.length?<View style={styles.section}><Text style={[styles.sectionLabel,dark&&darkStyles.bodyText]}>REGISTER</Text><View style={styles.chipRow}>{registers.map(r=><Pressable key={r.id} disabled={saving||printingId!==null} onPress={()=>{if(r.id===registerId)return;deviceEditEpoch.current+=1;setRegisterId(r.id);setPrinters([]);resetForm(true)}} style={[styles.chip, dark && darkStyles.chip, r.id===registerId&&styles.chipActive, dark && r.id===registerId && darkStyles.chipActive]}><Text style={[styles.chipText, dark && darkStyles.chipText, r.id===registerId&&styles.chipTextActive, dark && r.id===registerId && darkStyles.chipTextActive]}>{r.name}</Text></Pressable>)}</View></View>:null}
  {selectedRegister?<View style={styles.section}><Text style={[styles.sectionTitle,dark&&darkStyles.titleText]}>{selectedRegister.name}</Text>{!printers.length?<View style={[styles.emptyCard,dark&&darkStyles.card]}><Text style={[styles.emptyTitle,dark&&darkStyles.titleText]}>No printer configured</Text></View>:printers.map(p=><View key={p.id} style={[styles.printerCard,dark&&darkStyles.card]}><View style={styles.printerMain}><Ionicons name="print-outline" size={22} color={theme.colors.greenDark}/><View style={styles.flexOne}><Text style={[styles.printerName,dark&&darkStyles.titleText]}>{p.displayName}</Text><Text style={[styles.printerMeta,dark&&darkStyles.bodyText]}>{p.paperWidthMm} mm · {p.isDefault?'Default':'Additional'} · {p.isActive?'Active':'Inactive'}</Text></View></View><View style={styles.actionRow}>{capabilities.canManageDevices?<Pressable disabled={saving||printingId!==null} onPress={()=>void editPrinter(p)} style={[styles.smallButton, dark && darkStyles.outlineButton, (saving||printingId!==null)&&styles.disabled]}><Text style={[styles.smallButtonText, dark && darkStyles.titleText]}>Edit</Text></Pressable>:null}{capabilities.canPrintReceipt&&p.isActive?<Pressable disabled={saving||printingId!==null} onPress={()=>void testPrinter(p)} style={[styles.testButton,printingId!==null&&styles.disabled]}><Text style={styles.testButtonText}>{printingId===p.id?'Printing…':'Test print'}</Text></Pressable>:null}</View></View>)}</View>:null}
  {capabilities.canManageDevices&&selectedRegister?<View style={[styles.setupCard,dark&&darkStyles.card]}><View style={styles.sectionHeader}><Text style={[styles.sectionTitle,dark&&darkStyles.titleText]}>{editingId?'Update printer':'Add printer'}</Text>{editingId?<Pressable disabled={saving||printingId!==null} onPress={()=>resetForm()}><Text style={[styles.linkText, dark && darkStyles.accentText]}>Cancel</Text></Pressable>:null}</View>
   <Pressable disabled={discovering} onPress={()=>void loadPaired()} style={[styles.outlineButton, dark && darkStyles.outlineButton]}><Text style={[styles.outlineButtonText, dark && darkStyles.titleText]}>{discovering?'Loading…':'Show paired devices'}</Text></Pressable>
   {pairedDevices.map(d=><Pressable key={d.address} onPress={()=>selectDevice(d)} style={[styles.deviceRow, dark && darkStyles.deviceRow]}><Text style={[styles.flexOne, dark && darkStyles.bodyText]}>{d.name} · {d.address}</Text></Pressable>)}
   <Field label="Printer name" value={displayName} onChange={setDisplayName} dark={dark}/><Field label="Bluetooth address" value={deviceAddress} onChange={v=>setDeviceAddress(v.toUpperCase())} dark={dark}/>
   <Text style={[styles.fieldLabel, dark && darkStyles.bodyText]}>Paper width</Text><View style={styles.chipRow}>{([58,80]as const).map(w=>{const active=w===paperWidthMm;return <Pressable key={w} onPress={()=>setPaperWidthMm(w)} style={[styles.chip, dark && darkStyles.chip, active&&styles.chipActive, dark && active && darkStyles.chipActive]}><Text style={[styles.chipText, dark && darkStyles.chipText, active&&styles.chipTextActive, dark && active && darkStyles.chipTextActive]}>{w} mm</Text></Pressable>})}</View><ToggleRow label="Default printer" value={isDefault} onChange={setIsDefault} dark={dark} /><ToggleRow label="Active" value={isActive} onChange={setIsActive} dark={dark} />
   <View style={styles.copyHeader}><View style={styles.flexOne}><Text style={[styles.sectionTitle,dark&&darkStyles.titleText]}>Receipt copies</Text><Text style={[styles.helper,dark&&darkStyles.bodyText]}>Each configured copy prints separately and carries its own heading.</Text></View><Pressable disabled={copies.length>=8} onPress={addCopy}><Text style={[styles.linkText, dark && darkStyles.accentText]}>+ Add copy</Text></Pressable></View>
   {copies.map((copy,index)=><View key={`${index}-${copy.type}`} style={[styles.copyCard, dark && darkStyles.copyCard]}><View style={styles.chipRow}>{COPY_TYPES.map(option=><Pressable key={option.type} onPress={()=>changeCopyType(index,option.type)} style={[styles.copyChip, dark && darkStyles.chip, copy.type===option.type&&styles.chipActive, dark && copy.type===option.type && darkStyles.chipActive]}><Text style={[styles.copyChipText, dark && darkStyles.chipText, copy.type===option.type&&styles.chipTextActive, dark && copy.type===option.type && darkStyles.chipTextActive]}>{option.type==='custom'?'Custom':option.label.replace(' Copy','')}</Text></Pressable>)}</View>{copy.type==='custom'?<Field label="Custom copy name" value={copy.label} onChange={v=>changeCopyLabel(index,v)} dark={dark}/>:<Text style={[styles.helper, dark && darkStyles.bodyText]}>{copy.label}</Text>}<Pressable disabled={copies.length===1} onPress={()=>removeCopy(index)}><Text style={[styles.removeText, dark && darkStyles.removeText, copies.length===1&&styles.disabled]}>Remove copy</Text></Pressable></View>)}
   <Field label="Receipt footer (optional)" value={merchantFooter} onChange={setMerchantFooter} dark={dark} placeholder="Thank you for shopping with us"/>
   <Pressable disabled={saving||printingId!==null||!displayName.trim()||!deviceAddress.trim()} onPress={()=>void persistPrinter()} style={[styles.saveButton,(saving||printingId!==null||!displayName.trim()||!deviceAddress.trim())&&styles.disabled]}><Text style={styles.saveButtonText}>{saving?'Saving…':'Save printer'}</Text></Pressable>
  </View>:null}
 </View>;
}
async function durableInstallerCommand(storageKey:string,facts:string,proposedKey:string):Promise<string>{
  const prior=await AsyncStorage.getItem(storageKey);
  if(prior){
    try{
      const saved=JSON.parse(prior) as {facts?:unknown;key?:unknown};
      if(saved.facts===facts && typeof saved.key==='string'
        && saved.key.length>=12 && saved.key.length<=128)return saved.key;
    }catch{ /* malformed local state is superseded, not replayed */ }
  }
  await AsyncStorage.setItem(storageKey,JSON.stringify({facts,key:proposedKey}));
  return proposedKey;
}

function Field({label,value,onChange,dark,placeholder}:{label:string;value:string;onChange:(v:string)=>void;dark:boolean;placeholder?:string}){return <><Text style={[styles.fieldLabel,dark&&darkStyles.bodyText]}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={theme.colors.subtle} style={[styles.input,dark&&darkStyles.input]}/></>}
function ToggleRow({label,value,onChange,dark}:{label:string;value:boolean;onChange:(v:boolean)=>void;dark:boolean}){return <View style={styles.toggleRow}><Text style={[styles.toggleLabel, dark && darkStyles.titleText]}>{label}</Text><Switch value={value} onValueChange={onChange} trackColor={{ false:dark?theme.dark.borderStrong:'#D0D5DD', true:theme.colors.green }} thumbColor={theme.colors.white}/></View>}
function MessageCard({tone,text,dark}:{tone:'error'|'success';text:string;dark:boolean}){return <View style={[styles.messageCard,tone==='error'?styles.errorCard:styles.successCard,dark&&darkStyles.card]}><Text style={[styles.messageText,dark&&darkStyles.bodyText]}>{text}</Text></View>}
const styles=StyleSheet.create({stack:{gap:14},backRow:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:3,paddingVertical:4},backText:{color:theme.colors.navy,fontSize:13,fontWeight:'800'},heading:{gap:3},eyebrow:{color:theme.colors.muted,fontSize:10,fontWeight:'900',letterSpacing:1},title:{color:theme.colors.navy,fontSize:27,lineHeight:33,fontWeight:'900'},subtitle:{color:theme.colors.slate,fontSize:13,lineHeight:19},section:{gap:9},sectionHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},sectionLabel:{color:theme.colors.muted,fontSize:10,fontWeight:'900'},sectionTitle:{color:theme.colors.navy,fontSize:15,fontWeight:'900'},chipRow:{flexDirection:'row',flexWrap:'wrap',gap:7},chip:{minHeight:36,borderRadius:18,borderWidth:1,borderColor:theme.colors.border,paddingHorizontal:12,alignItems:'center',justifyContent:'center',backgroundColor:theme.colors.white},chipActive:{borderColor:'#75E0A7',backgroundColor:theme.colors.mintSoft},chipText:{color:theme.colors.slate,fontSize:11,fontWeight:'800'},chipTextActive:{color:theme.colors.greenDark},infoCard:{borderRadius:12,borderWidth:1,borderColor:'#ABEFC6',padding:11,flexDirection:'row',gap:8},infoText:{flex:1,color:theme.colors.slate,fontSize:11},messageCard:{borderRadius:12,borderWidth:1,padding:10},errorCard:{borderColor:'#FDA29B'},successCard:{borderColor:'#ABEFC6'},messageText:{color:theme.colors.slate,fontSize:11},emptyCard:{minHeight:80,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,padding:14,alignItems:'center',justifyContent:'center',gap:6},emptyTitle:{color:theme.colors.navy,fontSize:14,fontWeight:'900'},muted:{color:theme.colors.muted,fontSize:11},printerCard:{borderRadius:12,borderWidth:1,borderColor:theme.colors.border,padding:12,gap:10},printerMain:{flexDirection:'row',gap:9,alignItems:'center'},printerName:{color:theme.colors.navy,fontSize:14,fontWeight:'900'},printerMeta:{color:theme.colors.muted,fontSize:10},actionRow:{flexDirection:'row',justifyContent:'flex-end',gap:8},smallButton:{minHeight:38,borderRadius:11,borderWidth:1,borderColor:theme.colors.border,paddingHorizontal:12,justifyContent:'center'},smallButtonText:{fontSize:11,fontWeight:'900'},testButton:{minHeight:38,borderRadius:11,backgroundColor:theme.colors.green,paddingHorizontal:12,justifyContent:'center'},testButtonText:{color:theme.colors.white,fontSize:11,fontWeight:'900'},setupCard:{borderRadius:16,borderWidth:1,borderColor:theme.colors.border,padding:13,gap:10},outlineButton:{minHeight:42,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,justifyContent:'center',alignItems:'center'},outlineButtonText:{fontSize:11,fontWeight:'900'},deviceRow:{minHeight:44,borderRadius:10,borderWidth:1,borderColor:theme.colors.border,padding:10,flexDirection:'row'},fieldLabel:{color:theme.colors.slate,fontSize:11,fontWeight:'900'},input:{minHeight:44,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,paddingHorizontal:11,color:theme.colors.navy,fontSize:12},toggleRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},toggleLabel:{color:theme.colors.navy,fontSize:12,fontWeight:'800'},copyHeader:{flexDirection:'row',alignItems:'flex-start',gap:8,marginTop:5},copyCard:{borderRadius:12,borderWidth:1,borderColor:theme.colors.border,padding:10,gap:8},copyChip:{minHeight:30,borderRadius:15,borderWidth:1,borderColor:theme.colors.border,paddingHorizontal:9,justifyContent:'center'},copyChipText:{fontSize:10,fontWeight:'800'},helper:{color:theme.colors.slate,fontSize:11,lineHeight:16},removeText:{color:theme.colors.danger,fontSize:11,fontWeight:'800'},saveButton:{minHeight:44,borderRadius:12,backgroundColor:theme.colors.green,alignItems:'center',justifyContent:'center'},saveButtonText:{color:theme.colors.white,fontSize:12,fontWeight:'900'},linkText:{color:theme.colors.greenDark,fontSize:11,fontWeight:'900'},disabled:{opacity:.45},flexOne:{flex:1}});
const darkStyles=StyleSheet.create({
 card:{backgroundColor:theme.dark.surface,borderColor:theme.dark.border},
 outline:{backgroundColor:theme.dark.surfaceSubtle,borderColor:theme.dark.borderStrong},
 outlineButton:{backgroundColor:theme.dark.surfaceSubtle,borderColor:theme.dark.borderStrong},
 deviceRow:{backgroundColor:theme.dark.surfaceSubtle,borderColor:theme.dark.borderStrong},
 copyCard:{backgroundColor:theme.dark.surfaceRaised,borderColor:theme.dark.border},
 chip:{backgroundColor:theme.dark.surfaceSubtle,borderColor:theme.dark.borderStrong},
 chipActive:{backgroundColor:theme.dark.accentSoft,borderColor:theme.colors.green},
 chipText:{color:theme.dark.textMuted},
 chipTextActive:{color:theme.dark.accentText},
 input:{backgroundColor:theme.dark.surfaceSubtle,borderColor:theme.dark.borderStrong,color:theme.dark.text},
 titleText:{color:theme.dark.text},
 bodyText:{color:theme.dark.textMuted},
 accentText:{color:theme.dark.accentText},
 removeText:{color:theme.dark.dangerText},
});
