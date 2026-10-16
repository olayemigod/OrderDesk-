import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { loadCommerceProducts, type CommerceBranch, type CommerceProduct } from '../data/commerceRepository';
import { loadActiveStockCount, loadInventoryCapabilities, type InventoryCapabilities, type StockCountDetail } from '../data/inventoryRepository';
import { loadLowStock } from '../data/lowStockRepository';
import { isLikelyConnectivityError, loadCommerceProductCache, saveCommerceProductCache } from '../data/offlineSalesRepository';
import { sellerTrayUserMessage } from '../data/userFacingError';
import { useBusinesses } from '../hooks/useBusinesses';
import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import { InventoryWorkspace } from './InventoryWorkspace';
import { LowStockWorkspace } from './LowStockWorkspace';
import { ProductManagementWorkspace } from './ProductManagementWorkspace';
import { StockCountWorkspace } from './StockCountWorkspace';
import { StockTransferWorkspace } from './StockTransferWorkspace';

type Props = { tenantId: string; branch: CommerceBranch; currency?: string };
const NONE: InventoryCapabilities = { canReceiveStock:false, canAdjustStock:false, canCountStock:false, canApplyStockCount:false, canTransferStock:false };

export function InventoryTabWorkspace({ tenantId, branch, currency = '' }: Props) {
  const dark = useSellerTrayAppearance().dark;
  const { activeBusiness } = useBusinesses();
  const productCurrency = currency.trim() || (activeBusiness?.id === tenantId ? activeBusiness.currency.trim() : '');
  const [cap, setCap] = useState<InventoryCapabilities>(NONE);
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [count, setCount] = useState<StockCountDetail | null>(null);
  const [low, setLow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [countOpen, setCountOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [lowOpen, setLowOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [version, setVersion] = useState(0);

  async function refresh() {
    setLoading(true); setAccessError(null); setLow(null);
    try {
      const [nextCap, nextProducts] = await Promise.all([
        loadInventoryCapabilities(tenantId, branch.id),
        loadCommerceProducts(tenantId, { includeInactive:true }),
      ]);
      setCap(nextCap); setProducts(nextProducts);
      await saveCommerceProductCache(tenantId, nextProducts).catch(() => undefined);
      try { setLow((await loadLowStock(tenantId, branch.id)).length); } catch { setLow(null); }
      if (nextCap.canCountStock || nextCap.canApplyStockCount) {
        try { setCount(await loadActiveStockCount(tenantId, branch.id)); }
        catch (error) { setCount(null); setAccessError(sellerTrayUserMessage(error, 'Stock count is unavailable right now.')); }
      } else setCount(null);
    } catch (error) {
      setCap(NONE); setCount(null); setLow(null);
      const cached = isLikelyConnectivityError(error) ? await loadCommerceProductCache(tenantId) : null;
      setProducts(cached?.data ?? []);
      setAccessError(isLikelyConnectivityError(error) ? 'Inventory actions need a connection. Saved stock remains available to view.' : sellerTrayUserMessage(error, 'Inventory action access could not be verified.'));
    } finally { setLoading(false); }
  }

  useEffect(() => { setCountOpen(false); setTransferOpen(false); setLowOpen(false); setProductsOpen(false); setVersion(0); void refresh(); }, [tenantId, branch.id]);

  if (productsOpen) return <ProductManagementWorkspace tenantId={tenantId} currency={productCurrency} onClose={() => { setProductsOpen(false); setVersion(v => v + 1); void refresh(); }} />;
  if (lowOpen) return <LowStockWorkspace tenantId={tenantId} branch={branch} onClose={() => { setLowOpen(false); void refresh(); }} />;
  if (transferOpen) return <StockTransferWorkspace tenantId={tenantId} branch={branch} products={products} capabilities={cap} onInventoryChanged={() => setVersion(v => v + 1)} onClose={() => { setTransferOpen(false); setVersion(v => v + 1); void refresh(); }} />;
  if (countOpen) return <StockCountWorkspace tenantId={tenantId} branch={branch} products={products} capabilities={cap} onInventoryChanged={() => setVersion(v => v + 1)} onClose={() => { setCountOpen(false); setVersion(v => v + 1); void refresh(); }} />;

  const canCount = cap.canCountStock || cap.canApplyStockCount;
  return <View style={styles.stack}>
    <Card dark={dark} icon="pricetags-outline" title="Products" text="Search products, add one quickly or use a barcode as an optional shortcut." onPress={() => setProductsOpen(true)} />
    <Card dark={dark} icon={low && low > 0 ? 'alert-circle-outline' : 'checkmark-circle-outline'} title="Low stock" text={low === null ? 'Open branch stock alerts.' : low === 0 ? 'No product is at or below its branch threshold.' : `${low} product${low === 1 ? '' : 's'} need replenishment attention.`} onPress={() => setLowOpen(true)} alert={Boolean(low && low > 0)} badge={low && low > 0 ? low : undefined} />
    <Card dark={dark} icon="git-compare-outline" title="Stock transfers" text={cap.canTransferStock ? 'Move stock between accessible branches and confirm dispatch or receipt.' : 'View incoming and outgoing transfer history for this branch.'} onPress={() => setTransferOpen(true)} />
    {loading ? <View style={[styles.card, dark && darkStyles.card]}><ActivityIndicator size="small"/><View style={styles.copy}><Text style={[styles.title,dark&&darkStyles.title]}>Stock count</Text><Text style={[styles.text,dark&&darkStyles.body]}>Checking count access…</Text></View></View> : canCount ? <Card dark={dark} icon={count ? 'clipboard' : 'clipboard-outline'} title={count?.status === 'review' ? 'Review stock count' : count ? 'Continue stock count' : 'Stock count'} text={count ? `${count.reference} · ${count.status === 'review' ? 'Variance review ready' : `${count.capturedItems}/${count.totalItems} products counted`}` : 'Count physical stock, review variances, then apply authorised reconciliation.'} onPress={() => setCountOpen(true)} active={Boolean(count)} /> : accessError ? <View style={[styles.permission,dark&&darkStyles.subtle]}><Ionicons name="shield-outline" size={18} color={theme.colors.muted}/><Text style={[styles.permissionText,dark&&darkStyles.body]}>Inventory action access could not be verified. Inventory viewing remains available.</Text></View> : null}
    <InventoryWorkspace key={`${tenantId}:${branch.id}:${version}`} tenantId={tenantId} branch={branch}/>
  </View>;
}

function Card({dark,icon,title,text,onPress,alert=false,active=false,badge}:{dark:boolean;icon:string;title:string;text:string;onPress:()=>void;alert?:boolean;active?:boolean;badge?:number}) {
  const activeDark = dark && active;
  return <Pressable onPress={onPress} style={({pressed})=>[styles.card,dark&&darkStyles.card,alert&&styles.alert,active&&styles.active,activeDark&&darkStyles.active,pressed&&styles.pressed]}><View style={[styles.icon,(alert||active)&&styles.iconActive,activeDark&&darkStyles.activeIcon]}><Ionicons name={icon as never} size={22} color={alert?theme.colors.danger:activeDark?theme.colors.green:theme.colors.greenDark}/></View><View style={styles.copy}><Text style={[styles.title,dark&&darkStyles.title,activeDark&&darkStyles.activeTitle]}>{title}</Text><Text style={[styles.text,dark&&darkStyles.body,activeDark&&darkStyles.activeBody]}>{text}</Text></View>{badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}<Ionicons name="chevron-forward" size={19} color={activeDark?theme.colors.green:theme.colors.subtle}/></Pressable>;
}

const styles=StyleSheet.create({stack:{gap:14},card:{minHeight:82,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.white,padding:12,flexDirection:'row',alignItems:'center',gap:10},active:{borderColor:theme.colors.green,backgroundColor:theme.colors.mintSoft},alert:{borderColor:'#FDA29B',backgroundColor:theme.colors.dangerSoft},icon:{width:43,height:43,borderRadius:14,backgroundColor:theme.colors.cloud,alignItems:'center',justifyContent:'center'},iconActive:{backgroundColor:theme.colors.white},copy:{flex:1,minWidth:0},title:{color:theme.colors.navy,fontSize:14,fontWeight:'900'},text:{color:theme.colors.slate,fontSize:11,lineHeight:17,marginTop:2},badge:{minWidth:25,height:25,borderRadius:13,backgroundColor:theme.colors.danger,alignItems:'center',justifyContent:'center',paddingHorizontal:6},badgeText:{color:theme.colors.white,fontSize:10,fontWeight:'900'},permission:{borderRadius:theme.radius.md,backgroundColor:theme.colors.cloud,padding:10,flexDirection:'row',alignItems:'flex-start',gap:8},permissionText:{flex:1,color:theme.colors.muted,fontSize:11,lineHeight:17},pressed:{opacity:.76}});
const darkStyles=StyleSheet.create({card:{backgroundColor:theme.colors.navy,borderColor:'#344054'},active:{backgroundColor:'#162F46',borderColor:theme.colors.green},activeIcon:{backgroundColor:theme.colors.navy},activeTitle:{color:theme.colors.cloud},activeBody:{color:'#D0D5DD'},subtle:{backgroundColor:'#162F46',borderColor:'#344054'},title:{color:theme.colors.cloud},body:{color:'#D0D5DD'}});
