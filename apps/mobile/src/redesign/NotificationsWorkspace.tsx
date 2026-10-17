import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { SellerTrayText as Text } from '../components/SellerTrayText';
import { useBusinesses } from '../hooks/useBusinesses';
import { useMerchantNotifications } from '../hooks/useMerchantNotifications';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = { onClose: () => void };

export function NotificationsWorkspace({ onClose }: Props) {
  const dark = useSellerTrayAppearance().dark;
  const { activeBusiness } = useBusinesses();
  const notifications = useMerchantNotifications(activeBusiness?.id ?? null);
  const unread = notifications.unreadCount;

  return <View style={styles.stack}>
    <View style={styles.heading}>
      <View style={styles.headingCopy}>
        <Text style={[styles.eyebrow, dark && darkStyles.body]}>ACTIVITY</Text>
        <Text style={[styles.title, dark && darkStyles.title]}>Notifications</Text>
        <Text style={[styles.help, dark && darkStyles.body]}>{unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'You are all caught up.'}</Text>
      </View>
      <Pressable accessibilityLabel="Close notifications" onPress={onClose} style={[styles.icon, dark && darkStyles.card]}><Ionicons name="close" size={21} color={dark ? theme.colors.cloud : theme.colors.navy}/></Pressable>
    </View>

    {unread > 0 ? <Pressable onPress={() => void notifications.markAllRead()} style={styles.markAll}><Ionicons name="checkmark-done-outline" size={18} color={theme.colors.greenDark}/><Text style={styles.markAllText}>Mark all as read</Text></Pressable> : null}

    {notifications.loading && notifications.notifications.length === 0 ? <ActivityIndicator /> : notifications.notifications.length === 0 ? (
      <View style={[styles.empty, dark && darkStyles.card]}><Ionicons name="notifications-off-outline" size={24} color={theme.colors.muted}/><Text style={[styles.help, dark && darkStyles.body]}>No notifications yet.</Text></View>
    ) : notifications.notifications.map((item) => (
      <Pressable key={item.id} onPress={() => { if (!item.isRead) void notifications.markRead(item.id); }} style={[styles.card, dark && darkStyles.card, !item.isRead && styles.unread]}>
        <View style={[styles.dot, item.isRead && styles.dotRead]} />
        <View style={styles.copy}>
          <View style={styles.row}><Text style={[styles.itemTitle, dark && darkStyles.title]}>{item.title}</Text>{!item.isRead ? <Text style={styles.newLabel}>NEW</Text> : null}</View>
          <Text style={[styles.body, dark && darkStyles.body]}>{item.body}</Text>
          <Text style={[styles.time, dark && darkStyles.body]}>{new Date(item.createdAt).toLocaleString()}</Text>
        </View>
      </Pressable>
    ))}
  </View>;
}

const styles = StyleSheet.create({
  stack:{gap:12}, heading:{flexDirection:'row',gap:12,alignItems:'flex-start'}, headingCopy:{flex:1}, eyebrow:{fontSize:11,fontWeight:'900',letterSpacing:1,color:theme.colors.muted}, title:{fontSize:25,fontWeight:'900',color:theme.colors.navy}, help:{fontSize:12,lineHeight:18,color:theme.colors.muted}, icon:{width:42,height:42,borderRadius:13,backgroundColor:theme.colors.white,borderWidth:1,borderColor:theme.colors.border,alignItems:'center',justifyContent:'center'}, markAll:{alignSelf:'flex-end',flexDirection:'row',alignItems:'center',gap:5,paddingVertical:6}, markAllText:{color:theme.colors.greenDark,fontSize:12,fontWeight:'900'}, card:{borderRadius:14,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:12,flexDirection:'row',gap:10}, unread:{borderColor:theme.colors.green,backgroundColor:theme.colors.mintSoft}, dot:{width:9,height:9,borderRadius:5,backgroundColor:theme.colors.green,marginTop:5}, dotRead:{backgroundColor:theme.colors.border}, copy:{flex:1,gap:4}, row:{flexDirection:'row',alignItems:'center',gap:8}, itemTitle:{flex:1,color:theme.colors.navy,fontSize:14,fontWeight:'900'}, newLabel:{fontSize:9,fontWeight:'900',color:theme.colors.greenDark}, body:{color:theme.colors.slate,fontSize:12,lineHeight:18}, time:{color:theme.colors.muted,fontSize:10}, empty:{minHeight:100,alignItems:'center',justifyContent:'center',gap:8,borderRadius:14,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white}
});
const darkStyles=StyleSheet.create({card:{backgroundColor:theme.colors.navy,borderColor:'#344054'},title:{color:theme.colors.cloud},body:{color:'#D0D5DD'}});