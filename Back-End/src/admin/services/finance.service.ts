import prisma from '../../login/lib/prisma';
import {
  buildCreatedAtWhere,
  buildListResult,
  type DateRange,
  type SortOrder,
} from '../utils/admin-query.util';

const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'PAYMENT_PENDING', 'CANCELLED', 'COMPLETED'];
const REVENUE_STATUSES = ['COMPLETED'];

export type AdminStatsOptions = {
  range?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

export type AdminFinanceListOptions = {
  search?: string | undefined;
  status?: string | undefined;
  month?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  sortBy?: string | undefined;
  sortOrder?: SortOrder | undefined;
  dateRange?: DateRange | undefined;
  paginate?: boolean | undefined;
};

const financeSortFields = new Set(['createdAt', 'month', 'totalRevenue', 'platformFee', 'partnerNet', 'status']);

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const startOfYear = (date: Date) => new Date(date.getFullYear(), 0, 1);

const parseDate = (value?: string, end = false) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return end ? endOfDay(date) : startOfDay(date);
};

const resolveStatsRange = (options: AdminStatsOptions) => {
  const now = new Date();
  const explicitFrom = parseDate(options.from);
  const explicitTo = parseDate(options.to, true);

  if (explicitFrom || explicitTo) {
    const from = explicitFrom || new Date(0);
    const to = explicitTo || endOfDay(now);
    return { from, to, isAll: false };
  }

  const range = String(options.range || '30d').toLowerCase();
  if (range === 'all') return { isAll: true };
  if (range === 'today') return { from: startOfDay(now), to: endOfDay(now), isAll: false };
  if (range === '7d') return { from: startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)), to: endOfDay(now), isAll: false };
  if (range === 'month') return { from: startOfMonth(now), to: endOfDay(now), isAll: false };
  if (range === 'year') return { from: startOfYear(now), to: endOfDay(now), isAll: false };
  return { from: startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)), to: endOfDay(now), isAll: false };
};

const getPreviousRange = (range: ReturnType<typeof resolveStatsRange>) => {
  if (range.isAll || !range.from || !range.to) return null;
  const duration = range.to.getTime() - range.from.getTime() + 1;
  const previousTo = new Date(range.from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - duration + 1);
  return { from: previousFrom, to: previousTo };
};

const toCreatedAtRange = (range: { from?: Date; to?: Date; isAll?: boolean }) =>
  range.isAll ? {} : buildCreatedAtWhere({ from: range.from, to: range.to });

const trendPercent = (current: number, previous: number) => {
  if (!previous) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

const getPlatformFeeRate = () => {
  const raw = Number(process.env.PLATFORM_FEE_RATE);
  if (!Number.isFinite(raw) || raw < 0) return 0.1;
  return raw > 1 ? raw / 100 : raw;
};

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

const buildDailySeries = (
  range: ReturnType<typeof resolveStatsRange>,
  bookings: { createdAt: Date; totalPrice: number; status: string }[],
) => {
  const map = new Map<string, { date: string; name: string; revenue: number; bookings: number }>();
  const ensure = (key: string) => {
    if (!map.has(key)) map.set(key, { date: key, name: key.slice(5), revenue: 0, bookings: 0 });
    return map.get(key)!;
  };

  if (!range.isAll && range.from && range.to) {
    for (let cursor = startOfDay(range.from); cursor <= range.to; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
      ensure(dateKey(cursor));
    }
  }

  bookings.forEach((booking) => {
    const item = ensure(dateKey(booking.createdAt));
    item.bookings += 1;
    if (REVENUE_STATUSES.includes(booking.status)) item.revenue += Number(booking.totalPrice || 0);
  });

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
};

const buildUserGrowth = (range: ReturnType<typeof resolveStatsRange>, users: { createdAt: Date }[]) => {
  const map = new Map<string, { date: string; name: string; users: number }>();
  const ensure = (key: string) => {
    if (!map.has(key)) map.set(key, { date: key, name: key.slice(5), users: 0 });
    return map.get(key)!;
  };

  if (!range.isAll && range.from && range.to) {
    for (let cursor = startOfDay(range.from); cursor <= range.to; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
      ensure(dateKey(cursor));
    }
  }

  users.forEach((user) => {
    ensure(dateKey(user.createdAt)).users += 1;
  });

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
};

const buildFinanceWhere = (options: AdminFinanceListOptions) => {
  const query = String(options.search || '').trim();
  return {
    ...(query
      ? {
          OR: [
            { month: { contains: query, mode: 'insensitive' } },
            { status: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(options.month ? { month: { contains: options.month, mode: 'insensitive' } } : {}),
    ...(options.status ? { status: { equals: options.status } } : {}),
    ...buildCreatedAtWhere(options.dateRange || {}),
  };
};

const buildFinanceOrderBy = (sortBy?: string, sortOrder: SortOrder = 'desc') => ({
  [financeSortFields.has(String(sortBy || '')) ? String(sortBy) : 'createdAt']: sortOrder,
});

export const financeService = {
  getFinanceRecords: async (options: AdminFinanceListOptions = {}) => {
    const { page = 1, limit = 10, paginate = true } = options;
    const skip = (page - 1) * limit;
    const where = buildFinanceWhere(options);

    const [records, total] = await Promise.all([
      prisma.finance.findMany({
        where: where as any,
        orderBy: buildFinanceOrderBy(options.sortBy, options.sortOrder) as any,
        ...(paginate ? { skip, take: limit } : {}),
      }),
      prisma.finance.count({ where: where as any }),
    ]);

    return {
      ...buildListResult('finance', records, page, limit, total),
      records,
    };
  },

  getStats: async (options: AdminStatsOptions = {}) => {
    const range = resolveStatsRange(options);
    const previousRange = getPreviousRange(range);
    const currentCreatedAt = toCreatedAtRange(range);
    const previousCreatedAt = previousRange ? toCreatedAtRange(previousRange) : null;
    const revenueWhere = { status: { in: REVENUE_STATUSES as any }, ...currentCreatedAt };
    const previousRevenueWhere = previousCreatedAt ? { status: { in: REVENUE_STATUSES as any }, ...previousCreatedAt } : null;
    const feeRate = getPlatformFeeRate();

    const allHotelIds = await prisma.hotel.findMany({ select: { id: true } });
    const mirroredHotelIds = allHotelIds.map((hotel) => hotel.id);
    const legacyPropertyBaseWhere = {
      ...(mirroredHotelIds.length ? { id: { notIn: mirroredHotelIds } } : {}),
      ...currentCreatedAt,
    };

    const [
      totalUsers,
      totalCustomers,
      totalPartners,
      totalStaff,
      totalAdmins,
      totalHotels,
      pendingHotels,
      approvedHotels,
      totalLegacyProperties,
      pendingLegacyProperties,
      approvedLegacyProperties,
      totalBookings,
      bookingStatusGroups,
      revenueAggregate,
      revenueBookings,
      totalReviews,
      pendingReviews,
      totalVouchers,
      activeVouchers,
      currentBookingsForTrend,
      currentUsersForTrend,
      currentPartnersForTrend,
      previousRevenueAggregate,
      previousBookingsForTrend,
      previousUsersForTrend,
      previousPartnersForTrend,
      recentBookings,
      recentUsers,
      recentReviews,
      usersForGrowth,
    ] = await Promise.all([
      prisma.user.count({ where: currentCreatedAt as any }),
      prisma.user.count({ where: { role: 'customer' as any, ...currentCreatedAt } }),
      prisma.user.count({ where: { role: 'partner' as any, ...currentCreatedAt } }),
      prisma.user.count({ where: { role: { in: ['staff', 'OPERATOR', 'ACCOUNTANT'] as any }, ...currentCreatedAt } }),
      prisma.user.count({ where: { role: { in: ['admin', 'SUPER_ADMIN'] as any }, ...currentCreatedAt } }),
      prisma.hotel.count({ where: currentCreatedAt as any }),
      prisma.hotel.count({ where: { status: 'pending' as any, ...currentCreatedAt } }),
      prisma.hotel.count({ where: { status: 'approved' as any, ...currentCreatedAt } }),
      prisma.property.count({ where: legacyPropertyBaseWhere as any }),
      prisma.property.count({ where: { ...legacyPropertyBaseWhere, status: 'PENDING' as any } }),
      prisma.property.count({ where: { ...legacyPropertyBaseWhere, status: 'ACTIVE' as any } }),
      prisma.booking.count({ where: currentCreatedAt as any }),
      prisma.booking.groupBy({
        by: ['status'],
        where: currentCreatedAt as any,
        _count: { _all: true },
      }),
      prisma.booking.aggregate({
        where: revenueWhere as any,
        _sum: { totalPrice: true },
        _count: { _all: true },
      }),
      prisma.booking.findMany({
        where: currentCreatedAt as any,
        select: {
          id: true,
          status: true,
          totalPrice: true,
          createdAt: true,
          property: { select: { id: true, name: true } },
        },
      }),
      prisma.review.count({ where: currentCreatedAt as any }),
      prisma.review.count({ where: { status: 'PENDING' as any, ...currentCreatedAt } }),
      prisma.voucher.count({ where: currentCreatedAt as any }),
      prisma.voucher.count({ where: { status: 'ACTIVE' as any, ...currentCreatedAt } }),
      prisma.booking.count({ where: currentCreatedAt as any }),
      prisma.user.count({ where: currentCreatedAt as any }),
      prisma.user.count({ where: { role: 'partner' as any, ...currentCreatedAt } }),
      previousRevenueWhere
        ? prisma.booking.aggregate({ where: previousRevenueWhere as any, _sum: { totalPrice: true } })
        : Promise.resolve({ _sum: { totalPrice: 0 } }),
      previousCreatedAt ? prisma.booking.count({ where: previousCreatedAt as any }) : Promise.resolve(0),
      previousCreatedAt ? prisma.user.count({ where: previousCreatedAt as any }) : Promise.resolve(0),
      previousCreatedAt ? prisma.user.count({ where: { role: 'partner' as any, ...previousCreatedAt } }) : Promise.resolve(0),
      prisma.booking.findMany({
        where: currentCreatedAt as any,
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          user: { select: { id: true, username: true, email: true } },
          property: { select: { id: true, name: true } },
          room: { select: { id: true, name: true } },
        },
      }),
      prisma.user.findMany({
        where: currentCreatedAt as any,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, username: true, email: true, role: true, status: true, createdAt: true },
      }),
      prisma.review.findMany({
        where: currentCreatedAt as any,
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          user: { select: { username: true, email: true } },
          booking: { include: { property: { select: { id: true, name: true } } } },
        },
      }),
      prisma.user.findMany({
        where: currentCreatedAt as any,
        select: { createdAt: true },
      }),
    ]);

    const statusCounts = new Map(bookingStatusGroups.map((item: any) => [item.status, item._count._all]));
    const grossRevenue = Number(revenueAggregate._sum.totalPrice || 0);
    const platformFee = grossRevenue * feeRate;
    const partnerNet = grossRevenue - platformFee;
    const revenueBookingCount = Number((revenueAggregate as any)._count?._all || 0);
    const averageOrderValue = revenueBookingCount ? grossRevenue / revenueBookingCount : 0;
    const completedBookings = Number(statusCounts.get('COMPLETED') || 0);
    const completionRate = totalBookings ? Number(((completedBookings / totalBookings) * 100).toFixed(1)) : 0;

    const topHotelMap = new Map<string, { id: string; name: string; grossRevenue: number; totalBookings: number }>();
    revenueBookings.forEach((booking: any) => {
      if (!REVENUE_STATUSES.includes(booking.status) || !booking.property?.id) return;
      const current = topHotelMap.get(booking.property.id) || {
        id: booking.property.id,
        name: booking.property.name,
        grossRevenue: 0,
        totalBookings: 0,
      };
      current.grossRevenue += Number(booking.totalPrice || 0);
      current.totalBookings += 1;
      topHotelMap.set(booking.property.id, current);
    });

    const bookingByStatus = BOOKING_STATUSES.map((status) => ({
      status,
      name: status,
      value: Number(statusCounts.get(status) || 0),
    }));

    return {
      summary: {
        totalUsers,
        totalCustomers,
        totalPartners,
        totalStaff,
        totalAdmins,
        totalProperties: totalHotels + totalLegacyProperties,
        totalHotels: totalHotels + totalLegacyProperties,
        pendingProperties: pendingHotels + pendingLegacyProperties,
        pendingHotels: pendingHotels + pendingLegacyProperties,
        approvedProperties: approvedHotels + approvedLegacyProperties,
        approvedHotels: approvedHotels + approvedLegacyProperties,
        totalBookings,
        pendingBookings: Number(statusCounts.get('PENDING') || 0),
        confirmedBookings: Number(statusCounts.get('CONFIRMED') || 0),
        cancelledBookings: Number(statusCounts.get('CANCELLED') || 0),
        completedBookings,
        totalReviews,
        pendingReviews,
        totalVouchers,
        activeVouchers,
        grossRevenue,
        platformFee,
        platformFeeRate: feeRate,
        partnerNet,
        averageOrderValue,
        completionRate,
        bookingConversion: completionRate,
      },
      totalUsers,
      totalProperties: totalHotels + totalLegacyProperties,
      totalBookings,
      pendingReviews,
      totalRevenue: grossRevenue,
      grossRevenue,
      platformFee,
      partnerNet,
      trends: {
        revenue: trendPercent(grossRevenue, Number(previousRevenueAggregate._sum.totalPrice || 0)),
        bookings: trendPercent(currentBookingsForTrend, Number(previousBookingsForTrend || 0)),
        users: trendPercent(currentUsersForTrend, Number(previousUsersForTrend || 0)),
        partners: trendPercent(currentPartnersForTrend, Number(previousPartnersForTrend || 0)),
      },
      charts: {
        revenueByDay: buildDailySeries(range, revenueBookings),
        revenueSeries: buildDailySeries(range, revenueBookings),
        bookingByStatus,
        userGrowth: buildUserGrowth(range, usersForGrowth),
      },
      topHotels: Array.from(topHotelMap.values())
        .sort((a, b) => b.grossRevenue - a.grossRevenue)
        .slice(0, 5),
      recent: {
        bookings: recentBookings,
        users: recentUsers,
        reviews: recentReviews,
      },
    };
  },

  getNotifications: async () => {
    const [pendingProperties, pendingBookings, pendingReviews, recentUsers] = await Promise.all([
      prisma.property.count({ where: { status: 'PENDING' } }),
      prisma.booking.count({ where: { status: 'PENDING' } }),
      prisma.review.count({ where: { status: 'PENDING' } }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { id: true, username: true, role: true, createdAt: true },
      }),
    ]);

    return [
      ...(pendingProperties
        ? [{ id: 'pending-properties', type: 'lodging', title: 'Co so luu tru cho duyet', message: `${pendingProperties} co so dang cho duyet`, tab: 'lodging' }]
        : []),
      ...(pendingBookings
        ? [{ id: 'pending-bookings', type: 'booking', title: 'Booking cho xu ly', message: `${pendingBookings} booking dang cho xu ly`, tab: 'booking' }]
        : []),
      ...(pendingReviews
        ? [{ id: 'pending-reviews', type: 'reviews', title: 'Danh gia moi', message: `${pendingReviews} danh gia dang cho duyet`, tab: 'reviews' }]
        : []),
      ...recentUsers.map((item) => ({
        id: `user-${item.id}`,
        type: 'users',
        title: 'Nguoi dung moi',
        message: `${item.username} (${item.role}) vua tham gia`,
        tab: item.role === 'customer' ? 'customers' : item.role === 'partner' ? 'partners' : 'admins',
        createdAt: item.createdAt,
      })),
    ];
  },
};
