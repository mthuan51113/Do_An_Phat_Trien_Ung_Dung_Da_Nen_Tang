import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Calendar,
  DollarSign,
  Star,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react-native';
import { adminService } from '../../services/admin.service';
import { useAdminTheme } from '../AdminShell';

const RANGE_OPTIONS = [
  { label: 'Hôm nay', value: 'today' },
  { label: '7 ngày', value: '7d' },
  { label: '30 ngày', value: '30d' },
  { label: 'Tháng này', value: 'month' },
  { label: 'Năm nay', value: 'year' },
  { label: 'Tất cả', value: 'all' },
];

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#F59E0B',
  CONFIRMED: '#3B82F6',
  CHECKED_IN: '#2563EB',
  PAYMENT_PENDING: '#D97706',
  CANCELLED: '#EF4444',
  COMPLETED: '#10B981',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chờ xử lý',
  CONFIRMED: 'Đã xác nhận',
  CHECKED_IN: 'Đã nhận phòng',
  PAYMENT_PENDING: 'Chờ thanh toán',
  CANCELLED: 'Đã hủy',
  COMPLETED: 'Hoàn tất',
};

const formatCurrency = (value: number) =>
  `${Number(value || 0).toLocaleString('vi-VN')} VND`;

const formatNumber = (value: number) => Number(value || 0).toLocaleString('vi-VN');

const MetricCard = ({ title, value, trend, icon: Icon, color }: any) => {
  const { isLight } = useAdminTheme();
  const numericTrend = Number(trend || 0);

  return (
    <View style={[styles.metricCard, !isLight && styles.surfaceDark]}>
      <View style={styles.metricHeader}>
        <View style={[styles.iconContainer, { backgroundColor: `${color}20` }]}>
          <Icon size={20} color={color} />
        </View>
        <View style={[styles.trendBadge, { backgroundColor: numericTrend >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)' }]}>
          {numericTrend >= 0 ? <ArrowUpRight size={14} color="#10B981" /> : <ArrowDownRight size={14} color="#EF4444" />}
          <Text style={[styles.trendText, { color: numericTrend >= 0 ? '#10B981' : '#EF4444' }]}>{Math.abs(numericTrend)}%</Text>
        </View>
      </View>
      <Text style={[styles.metricValue, !isLight && styles.textLight]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.metricTitle, !isLight && styles.mutedTextDark]}>{title}</Text>
    </View>
  );
};

export const DashboardOverview = () => {
  const { isLight } = useAdminTheme();
  const [range, setRange] = React.useState('30d');
  const [stats, setStats] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await adminService.getStats({ range });
        setStats(data);
      } catch (err) {
        console.error('Failed to fetch stats:', err);
        setError('Không thể tải dữ liệu tổng quan.');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [range]);

  if (Platform.OS !== 'web') {
    return <View style={styles.container}><Text style={{ color: isLight ? '#0F172A' : '#FFFFFF' }}>Bảng điều khiển chỉ khả dụng trên Web</Text></View>;
  }

  const summary = stats?.summary || {};
  const trends = stats?.trends || {};
  const revenueData = stats?.charts?.revenueByDay || [];
  const statusData = (stats?.charts?.bookingByStatus || []).map((item: any) => ({
    ...item,
    name: STATUS_LABELS[item.status] || item.name || item.status,
    color: STATUS_COLORS[item.status] || '#64748B',
  }));
  const hasRevenueData = revenueData.some((item: any) => Number(item.revenue || 0) > 0 || Number(item.bookings || 0) > 0);
  const hasStatusData = statusData.some((item: any) => Number(item.value || 0) > 0);

  return (
    <View style={styles.container}>
      <View style={styles.rangeRow}>
        {RANGE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[styles.rangeBtn, !isLight && styles.rangeBtnDark, range === option.value && styles.rangeBtnActive]}
            onPress={() => setRange(option.value)}
          >
            <Text style={[styles.rangeText, !isLight && styles.mutedTextDark, range === option.value && styles.rangeTextActive]}>{option.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator size="small" color="#3B82F6" />
          <Text style={[styles.stateText, !isLight && styles.mutedTextDark]}>Đang tải dữ liệu...</Text>
        </View>
      ) : error ? (
        <View style={styles.stateBox}>
          <Text style={[styles.errorText]}>{error}</Text>
        </View>
      ) : (
        <>
          <View style={styles.gridRow}>
            <MetricCard title="Người dùng" value={formatNumber(summary.totalUsers)} trend={trends.users} icon={Users} color="#3B82F6" />
            <MetricCard title="Cơ sở lưu trú" value={formatNumber(summary.totalHotels || summary.totalProperties)} trend={trends.partners} icon={Building2} color="#14B8A6" />
            <MetricCard title="Đặt phòng" value={formatNumber(summary.totalBookings)} trend={trends.bookings} icon={Calendar} color="#8B5CF6" />
            <MetricCard title="Đánh giá chờ duyệt" value={formatNumber(summary.pendingReviews)} trend={0} icon={Star} color="#F59E0B" />
          </View>

          <View style={styles.gridRow}>
            <MetricCard title="Doanh thu gộp" value={formatCurrency(summary.grossRevenue)} trend={trends.revenue} icon={DollarSign} color="#2563EB" />
            <MetricCard title="Phí nền tảng" value={formatCurrency(summary.platformFee)} trend={trends.revenue} icon={TrendingUp} color="#DC2626" />
            <MetricCard title="Đối tác nhận" value={formatCurrency(summary.partnerNet)} trend={trends.revenue} icon={Wallet} color="#059669" />
          </View>

          <View style={styles.chartGrid}>
            <View style={[styles.chartCard, !isLight && styles.surfaceDark, { flex: 2 }]}>
              <Text style={[styles.chartTitle, !isLight && styles.textLight]}>Doanh thu & đặt phòng theo ngày</Text>
              {hasRevenueData ? (
                <View style={styles.chartBox}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={revenueData}>
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isLight ? '#E2E8F0' : '#334155'} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: isLight ? '#64748B' : '#94A3B8', fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: isLight ? '#64748B' : '#94A3B8', fontSize: 12 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
                      <Area type="monotone" dataKey="bookings" stroke="#10B981" strokeWidth={3} fillOpacity={0} />
                    </AreaChart>
                  </ResponsiveContainer>
                </View>
              ) : (
                <Text style={[styles.emptyText, !isLight && styles.mutedTextDark]}>Chưa có dữ liệu trong kỳ này.</Text>
              )}
            </View>

            <View style={[styles.chartCard, !isLight && styles.surfaceDark, { flex: 1 }]}>
              <Text style={[styles.chartTitle, !isLight && styles.textLight]}>Trạng thái đặt phòng</Text>
              {hasStatusData ? (
                <View style={styles.chartBox}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} cx="50%" cy="50%" innerRadius={58} outerRadius={82} paddingAngle={6} dataKey="value">
                        {statusData.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                </View>
              ) : (
                <Text style={[styles.emptyText, !isLight && styles.mutedTextDark]}>Chưa có booking trong kỳ này.</Text>
              )}
            </View>
          </View>

          <View style={[styles.activityCard, !isLight && styles.surfaceDark]}>
            <Text style={[styles.chartTitle, !isLight && styles.textLight]}>Hoạt động gần đây</Text>
            {(stats?.recent?.bookings || []).length ? (
              stats.recent.bookings.map((booking: any) => (
                <View key={booking.id} style={[styles.activityItem, !isLight && styles.activityItemDark]}>
                  <Text style={[styles.activityName, !isLight && styles.textLight]}>{booking.user?.username || booking.user?.email || 'Khách hàng'}</Text>
                  <Text style={[styles.activityDetail, !isLight && styles.mutedTextDark]}>{booking.property?.name || 'Cơ sở lưu trú'} - {booking.status}</Text>
                </View>
              ))
            ) : (
              <Text style={[styles.emptyText, !isLight && styles.mutedTextDark]}>Chưa có hoạt động gần đây.</Text>
            )}
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  rangeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  rangeBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' },
  rangeBtnDark: { backgroundColor: '#1E293B', borderColor: '#334155' },
  rangeBtnActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  rangeText: { color: '#475569', fontSize: 13, fontWeight: '700' },
  rangeTextActive: { color: '#FFFFFF' },
  stateBox: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { color: '#64748B', fontSize: 14 },
  errorText: { color: '#DC2626', fontSize: 14, fontWeight: '700' },
  gridRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 18 },
  metricCard: { flex: 1, minWidth: 220, backgroundColor: '#FFFFFF', borderRadius: 8, padding: 20, borderWidth: 1, borderColor: '#E2E8F0', ...Platform.select({ web: { boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)' } as any }) },
  surfaceDark: { backgroundColor: '#1E293B', borderColor: '#334155', ...Platform.select({ web: { boxShadow: 'none' } as any }) },
  metricHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  iconContainer: { width: 44, height: 44, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  trendText: { fontSize: 12, fontWeight: '700' },
  metricValue: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  metricTitle: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  textLight: { color: '#FFFFFF' },
  mutedTextDark: { color: '#94A3B8' },
  chartGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginBottom: 18 },
  chartCard: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 20, borderWidth: 1, borderColor: '#E2E8F0', minWidth: 340, ...Platform.select({ web: { boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)' } as any }) },
  chartTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 18 },
  chartBox: { height: 300, width: '100%' },
  emptyText: { color: '#64748B', fontSize: 14 },
  activityCard: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 20, borderWidth: 1, borderColor: '#E2E8F0', ...Platform.select({ web: { boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)' } as any }) },
  activityItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  activityItemDark: { borderBottomColor: '#334155' },
  activityName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  activityDetail: { fontSize: 12, color: '#64748B', marginTop: 4 },
});
