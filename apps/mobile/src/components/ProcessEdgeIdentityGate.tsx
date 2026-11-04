import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { supabase } from '../lib/supabase';
import { SellerTrayLoadingScreen } from './SellerTrayLoadingScreen';
import ProcessEdgeInstallationsView from './ProcessEdgeInstallationsView';

type StaffProfile = { isInstaller: boolean; status: string | null };
type GateState =
  | { kind: 'checking' }
  | { kind: 'merchant' }
  | { kind: 'installer'; status: string | null }
  | { kind: 'error'; message: string };

/**
 * ProcessEdge staff identity is intentionally separate from a merchant Business.
 * This gate runs immediately after AuthGate and before merchant legal acceptance,
 * invitations and Create Business. A failed internal-role lookup fails closed.
 */
export function ProcessEdgeIdentityGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const epoch = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    setState({ kind: 'checking' });
    try {
      const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionResult.session?.user?.id) {
        throw new Error('Sign in again to verify your SellerTray account.');
      }

      const { data, error } = await supabase.functions.invoke('platform-setup-installer', {
        body: { action: 'profile' },
      });
      if (error) throw error;
      const profile = data as Partial<StaffProfile> | null;
      if (typeof profile?.isInstaller !== 'boolean') {
        throw new Error('Account access check returned an invalid result.');
      }
      if (request !== epoch.current) return;

      if (profile.isInstaller) {
        // A ProcessEdge staff account must never fall through to Business
        // onboarding or gain Merchant POS operations after a partial lookup.
        if (!['pending', 'active', 'suspended', 'revoked'].includes(profile.status ?? '')) {
          throw new Error('ProcessEdge staff account status could not be verified.');
        }
        setState({ kind: 'installer', status: profile.status ?? null });
      } else {
        setState({ kind: 'merchant' });
      }
    } catch (cause) {
      if (request !== epoch.current) return;
      setState({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'Unable to verify SellerTray account access.',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // AuthGate manages sign-in/out; invalidating the pending request keeps an
      // old role lookup from rendering against a newer authenticated user.
      if (event === 'SIGNED_OUT') {
        epoch.current++;
        setState({ kind: 'checking' });
      } else if (event === 'SIGNED_IN') {
        void Promise.resolve().then(() => refresh());
      }
    });
    return () => {
      epoch.current++;
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  if (state.kind === 'checking') {
    return <SellerTrayLoadingScreen message="Verifying SellerTray account access…" />;
  }
  if (state.kind === 'merchant') return <>{children}</>;
  if (state.kind === 'installer') {
    return <ProcessEdgeInstallationsView
      status={state.status}
      onRefreshProfile={() => void refresh()}
    />;
  }

  return <SafeAreaView style={styles.safe}>
    <View style={styles.card}>
      <Text style={styles.title}>Account access unavailable</Text>
      <Text style={styles.copy}>{state.message}</Text>
      <Text style={styles.copy}>
        ProcessEdge installation accounts cannot be used as merchant Business accounts.
        Retry the account check rather than creating another Business.
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.button}>
        <Text style={styles.buttonText}>Retry account check</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => void supabase.auth.signOut({ scope: 'local' })}>
        <Text style={styles.link}>Sign out</Text>
      </Pressable>
    </View>
  </SafeAreaView>;
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:'#F8FAFC',justifyContent:'center',padding:22},
  card:{backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#E4E7EC',borderRadius:14,padding:20,gap:14},
  title:{color:'#102A43',fontSize:20,fontWeight:'800'},
  copy:{color:'#475467',fontSize:14,lineHeight:21},
  button:{backgroundColor:'#12B76A',padding:14,borderRadius:10,alignItems:'center'},
  buttonText:{color:'#102A43',fontWeight:'800'},
  link:{color:'#087F4D',fontWeight:'700'},
});
