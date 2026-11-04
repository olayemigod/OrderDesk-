import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';

type Installation = {
  assignmentId:string;
  appointmentId:string;
  tenantId:string;
  businessName:string;
  branchId:string;
  branchName:string;
  scheduledStartAt:string;
  scheduledEndAt:string;
  appointmentStatus:string;
  validUntil:string;
};

export default function ProcessEdgeInstallationsView({
  status,onRefreshProfile,
}: { status:string | null; onRefreshProfile:()=>void }) {
  const appearance=useSellerTrayAppearance();
  const dark=appearance.dark;
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [verified,setVerified]=useState(false);
  const [factorId,setFactorId]=useState('');
  const [secret,setSecret]=useState('');
  const [code,setCode]=useState('');
  const [installations,setInstallations]=useState<Installation[]>([]);
  const [error,setError]=useState<string | null>(null);

  useEffect(()=>{void refresh();},[status]);

  async function refresh() {
    setLoading(true);setError(null);
    try {
      const [{data:level,error:levelError},{data:factors,error:factorError}]=await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      if(levelError || factorError) throw new Error(levelError?.message ?? factorError?.message);
      const activeFactor=factors.totp.find(f=>f.status==='verified');
      setFactorId(activeFactor?.id ?? '');
      setVerified(level.currentLevel==='aal2');
      if(level.currentLevel==='aal2' && status==='active') await loadInstallations();
      else setInstallations([]);
    } catch(cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to verify ProcessEdge login.');
    } finally {setLoading(false);}
  }

  async function loadInstallations() {
    const {data,error:requestError}=await supabase.functions.invoke('platform-setup-installer',{
      body:{action:'mine'},
    });
    if(requestError) throw requestError;
    const payload=data as {appointments?:Installation[]};
    setInstallations(Array.isArray(payload?.appointments) ? payload.appointments : []);
  }

  async function enrolTotp() {
    setBusy(true);setError(null);
    try {
      const {data,error:enrolError}=await supabase.auth.mfa.enroll({
        factorType:'totp',friendlyName:'ProcessEdge SellerTray Installation',
      });
      if(enrolError || !data) throw new Error(enrolError?.message ?? 'Could not start verification.');
      // The factor secret is shown only in the live enrollment view and is
      // never sent to SellerTray server logs, analytics or order records.
      setFactorId(data.id);
      setSecret(data.totp?.secret ?? '');
    } catch(cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to set up verification.');
    } finally {setBusy(false);}
  }

  async function verifyTotp() {
    if(!factorId || !/^\d{6}$/.test(code.trim())) {
      setError('Enter the current six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);setError(null);
    try {
      const {error:verificationError}=await supabase.auth.mfa.challengeAndVerify({
        factorId,code:code.trim(),
      });
      if(verificationError) throw verificationError;
      setCode('');setSecret('');
      await refresh();
    }catch(cause){
      setError(cause instanceof Error ? cause.message : 'Could not confirm the verification code.');
    }finally{setBusy(false);}
  }

  return <SafeAreaView style={[styles.screen,dark&&styles.screenDark]}>
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={[styles.eyebrow,dark&&styles.textSecondary]}>PROCESSEDGE INSTALLATIONS</Text>
      <Text style={[styles.title,dark&&styles.textLight]}>My Installations</Text>
      <Text style={[styles.subtitle,dark&&styles.textSecondary]}>
        View the Branch setup appointments assigned to your ProcessEdge account. Merchant sales and accounts are separate.
      </Text>

      {error?<View style={styles.error}><Text style={styles.errorText}>{error}</Text></View>:null}
      {status!=='active'?<View style={[styles.card,dark&&styles.cardDark]}>
        <Text style={[styles.cardTitle,dark&&styles.textLight]}>Account awaiting access</Text>
        <Text style={[styles.body,dark&&styles.textSecondary]}>
          {status==='pending'
            ? 'A ProcessEdge administrator must verify and activate your installation account before appointments become available.'
            : status==='suspended'
              ? 'Your installation access is suspended. Contact ProcessEdge administration.'
              : 'Your installation access has been revoked. Contact ProcessEdge administration.'}
        </Text>
      </View>:null}

      {status==='active' && !loading && !verified ? <View style={[styles.card,dark&&styles.cardDark]}>
        <Text style={[styles.cardTitle,dark&&styles.textLight]}>Secure staff sign-in</Text>
        <Text style={[styles.body,dark&&styles.textSecondary]}>
          Confirm a code from your authenticator to access assigned installations.
        </Text>
        {!factorId?<Pressable disabled={busy} onPress={()=>void enrolTotp()} style={styles.action}>
          <Text style={styles.actionText}>Set up authenticator</Text>
        </Pressable>:null}
        {secret?<View style={styles.secretCard}>
          <Text style={styles.body}>Add this one-time setup key in your authenticator app:</Text>
          <Text selectable style={styles.secret}>{secret}</Text>
          <Text style={styles.body}>Never share this key. It will disappear after verification.</Text>
        </View>:null}
        {factorId?<View style={styles.form}>
          <Text style={[styles.body,dark&&styles.textSecondary]}>Verification code</Text>
          <TextInput
            accessibilityLabel="Six-digit authenticator code"
            keyboardType="number-pad" maxLength={6} value={code}
            onChangeText={setCode} placeholder="123456"
            style={[styles.input,dark&&styles.inputDark]}
          />
          <Pressable disabled={busy||code.trim().length!==6}
            onPress={()=>void verifyTotp()} style={[styles.action,busy&&styles.disabled]}>
            <Text style={styles.actionText}>{busy?'Verifying…':'Verify staff login'}</Text>
          </Pressable>
        </View>:null}
      </View>:null}

      {status==='active' && verified ? <>
        <Text style={[styles.heading,dark&&styles.textLight]}>Assigned Branch appointments</Text>
        {loading?<ActivityIndicator color={theme.colors.greenDark}/>:null}
        {!loading&&!installations.length?<View style={[styles.card,dark&&styles.cardDark]}>
          <Text style={[styles.cardTitle,dark&&styles.textLight]}>No active assignments</Text>
          <Text style={[styles.body,dark&&styles.textSecondary]}>
            Only appointments assigned to your ProcessEdge account appear here. Your manager can assign a Branch setup.
          </Text>
        </View>:null}
        {installations.map(item=><View key={item.assignmentId} style={[styles.card,dark&&styles.cardDark]}>
          <Text style={[styles.cardTitle,dark&&styles.textLight]}>{item.businessName}</Text>
          <Text style={[styles.body,dark&&styles.textSecondary]}>{item.branchName} · {item.appointmentStatus.replace('_',' ')}</Text>
          <Text style={[styles.body,dark&&styles.textSecondary]}>Appointment: {new Date(item.scheduledStartAt).toLocaleString()}</Text>
          <Text style={[styles.body,dark&&styles.textSecondary]}>Assigned until: {new Date(item.validUntil).toLocaleString()}</Text>
          <Text style={[styles.helper,dark&&styles.textSecondary]}>
            Printer installation actions require verified Branch and appointment authority and are not yet enabled in this build.
          </Text>
        </View>)}
      </>:null}

      <View style={styles.footer}>
        <Pressable onPress={()=>{onRefreshProfile();void refresh()}} disabled={busy}>
          <Text style={styles.link}>Refresh access</Text>
        </Pressable>
        <Pressable onPress={()=>void supabase.auth.signOut({scope:'local'})}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:'#F8FAFC'},screenDark:{backgroundColor:'#102A43'},
  container:{padding:22,paddingBottom:54,gap:14},
  eyebrow:{color:'#475467',fontSize:12,fontWeight:'800',letterSpacing:1},
  title:{color:'#102A43',fontSize:26,fontWeight:'800'},
  subtitle:{color:'#475467',fontSize:14,lineHeight:21},
  heading:{fontSize:17,color:'#102A43',fontWeight:'800',marginTop:12},
  textLight:{color:'#F8FAFC'},textSecondary:{color:'#CBD5E1'},
  card:{padding:16,borderWidth:1,borderColor:'#E4E7EC',backgroundColor:'#FFFFFF',borderRadius:14,gap:10},
  cardDark:{backgroundColor:'#183B56',borderColor:'#475467'},
  cardTitle:{color:'#102A43',fontWeight:'800',fontSize:16},
  body:{color:'#475467',fontSize:13,lineHeight:20},
  helper:{color:'#667085',fontSize:12,lineHeight:18,marginTop:8},
  form:{gap:10},
  input:{backgroundColor:'#FFFFFF',borderColor:'#D0D5DD',borderWidth:1,borderRadius:9,padding:12,color:'#102A43',fontSize:16},
  inputDark:{backgroundColor:'#F8FAFC'},
  action:{backgroundColor:'#12B76A',padding:13,borderRadius:10,alignItems:'center'},
  actionText:{fontWeight:'800',color:'#102A43'},
  disabled:{opacity:0.55},
  error:{padding:13,backgroundColor:'#FEE4E2',borderRadius:10},
  errorText:{color:'#B42318',fontSize:13},
  secretCard:{padding:12,borderRadius:9,backgroundColor:'#D9FBE8',gap:8},
  secret:{color:'#102A43',fontSize:15,fontWeight:'700',letterSpacing:1},
  footer:{flexDirection:'row',justifyContent:'space-between',paddingTop:16},
  link:{color:'#12B76A',fontWeight:'700'},
});
