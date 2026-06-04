import prisma from '../../login/lib/prisma';
import { generateUniqueSlug } from '../../shared/utils/slug.util';
import { uploadService } from './upload.service';
import { BUCKETS } from '../../shared/config/minio';
import { NotFoundError, ForbiddenError, UnprocessableError } from '../../shared/errors/AppError';
import type { CreateHotelInput, UpdateHotelInput, HotelQueryInput } from '../middlewares/hotel.validator';
import type { Prisma } from '@prisma/client';

// Full include for hotel detail
const hotelDetailInclude = {
  address: true,
  images: {
    orderBy: { sortOrder: 'asc' as const },
  },
  videos: {
    orderBy: { sortOrder: 'asc' as const },
  },
  hotelAmenities: {
    include: { amenity: true },
  },
  roomTypes: {
    where: { status: 'active' as const },
    include: {
      pricingPolicies: { where: { isActive: true } },
      roomTypeAmenities: { include: { amenity: true } },
      media: { orderBy: { sortOrder: 'asc' as const } },
      _count: { select: { roomUnits: true } },
    },
    orderBy: { sortOrder: 'asc' as const },
  },
  owner: {
    select: { id: true, username: true, email: true, avatar: true },
  },
};

// List include (lighter)
const hotelListInclude = {
  address: {
    select: { city: true, district: true, fullAddress: true },
  },
  images: {
    where: { isCover: true },
    take: 1,
  },
  hotelAmenities: {
    include: { amenity: { select: { id: true, name: true, icon: true } } },
    take: 5,
  },
};

export class HotelService {

  // ---- Ownership verification helper ----
  private async verifyOwnership(hotelId: string, ownerId: string) {
    const hotel = await prisma.hotel.findUnique({
      where: { id: hotelId },
      select: { id: true, ownerId: true, status: true },
    });
    if (!hotel) throw new NotFoundError('Không tìm thấy khách sạn', 'HOTEL_NOT_FOUND');
    if (hotel.ownerId !== ownerId) throw new ForbiddenError('Bạn không có quyền chỉnh sửa khách sạn này');
    return hotel;
  }

  /**
   * Create a new hotel (Partner)
   */
  async create(ownerId: string, data: CreateHotelInput) {
    const slug = generateUniqueSlug(data.name);
    const fullAddress = [data.address.addressLine, data.address.ward, data.address.district, data.address.city, data.address.province]
      .filter(Boolean).join(', ');

    const hotel = await prisma.hotel.create({
      data: {
        ownerId,
        name: data.name,
        slug,
        description: data.description ?? null,
        propertyType: data.propertyType,
        starRating: data.starRating,
        checkInTime: data.checkInTime,
        checkOutTime: data.checkOutTime,
        minBookingHours: data.minBookingHours,
        cancellationPolicy: data.cancellationPolicy,
        cancellationHours: data.cancellationHours,
        depositPercent: data.depositPercent,
        // Address
        address: {
          create: {
            addressLine: data.address.addressLine,
            ward: data.address.ward ?? null,
            district: data.address.district,
            city: data.address.city,
            province: data.address.province,
            country: data.address.country ?? null,
            latitude: data.address.latitude ?? null,
            longitude: data.address.longitude ?? null,
            fullAddress,
          },
        },
        // Amenities
        ...(data.amenityIds && data.amenityIds.length > 0
          ? {
              hotelAmenities: {
                createMany: {
                  data: data.amenityIds.map((amenityId) => ({ amenityId })),
                },
              },
            }
          : {}),
      } as any,
      include: hotelDetailInclude,
    });

    return hotel;
  }

  /**
   * Update hotel (Partner - owner only)
   */
  async update(hotelId: string, ownerId: string, data: UpdateHotelInput) {
    await this.verifyOwnership(hotelId, ownerId);

    // Build update data
    const updateData: any = {};
    if (data.name) {
      updateData.name = data.name;
      updateData.slug = generateUniqueSlug(data.name);
    }
    if (data.description !== undefined) updateData.description = data.description;
    if (data.propertyType) updateData.propertyType = data.propertyType;
    if (data.starRating !== undefined) updateData.starRating = data.starRating;
    if (data.checkInTime) updateData.checkInTime = data.checkInTime;
    if (data.checkOutTime) updateData.checkOutTime = data.checkOutTime;
    if (data.minBookingHours !== undefined) updateData.minBookingHours = data.minBookingHours;
    if (data.cancellationPolicy) updateData.cancellationPolicy = data.cancellationPolicy;
    if (data.cancellationHours !== undefined) updateData.cancellationHours = data.cancellationHours;
    if (data.depositPercent !== undefined) updateData.depositPercent = data.depositPercent;

    const hotel = await prisma.$transaction(async (tx) => {
      await tx.hotel.update({ where: { id: hotelId }, data: updateData });

      // Update address if provided
      if (data.address) {
        const currentAddr = await tx.hotelAddress.findUnique({ where: { hotelId } });
        if (currentAddr) {
          const merged = { ...currentAddr, ...data.address };
          const fullAddress = [merged.addressLine, merged.ward, merged.district, merged.city, merged.province]
            .filter(Boolean).join(', ');

          await tx.hotelAddress.update({
            where: { hotelId },
            data: { ...data.address, fullAddress } as any, // Ép kiểu chống lỗi strict type của Prisma 7.8
          });
        }
      }

      // Update amenities if provided
      if (data.amenityIds) {
        await tx.hotelAmenity.deleteMany({ where: { hotelId } });
        if (data.amenityIds.length > 0) {
          await tx.hotelAmenity.createMany({
            data: data.amenityIds.map((amenityId) => ({ hotelId, amenityId })) as any, // Ép kiểu chống lỗi mapping mảng dữ liệu
          });
        }
      }

      return tx.hotel.findUnique({
        where: { id: hotelId },
        include: hotelDetailInclude,
      });
    });

    return hotel;
  }

  /**
   * Get hotel by ID (Partner - owner only)
   */
  async getById(hotelId: string, ownerId: string) {
    const hotel = await prisma.hotel.findUnique({
      where: { id: hotelId },
      include: hotelDetailInclude,
    });
    if (!hotel) throw new NotFoundError('Không tìm thấy khách sạn', 'HOTEL_NOT_FOUND');
    if (hotel.ownerId !== ownerId) throw new ForbiddenError('Bạn không có quyền xem khách sạn này');
    return hotel;
  }

  /**
   * Get hotel by slug (Public)
   */
  async getBySlug(slug: string) {
    const hotel = await prisma.hotel.findUnique({
      where: { slug, status: 'approved' },
      include: hotelDetailInclude,
    });
    if (!hotel) throw new NotFoundError('Không tìm thấy khách sạn', 'HOTEL_NOT_FOUND');
    return hotel;
  }

  /**
   * List hotels for a partner (owner)
   */
  async listByOwner(ownerId: string, query: HotelQueryInput) {
    const where: Prisma.HotelWhereInput = { ownerId };

    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.HotelOrderByWithRelationInput = {};
    const sortField = query.sort === 'created_at' ? 'createdAt' :
                      query.sort === 'avg_rating' ? 'avgRating' : 'name';
    (orderBy as any)[sortField] = query.order;

    const [items, totalItems] = await Promise.all([
      prisma.hotel.findMany({
        where,
        include: hotelListInclude,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.hotel.count({ where }),
    ]);

    return { items, totalItems };
  }

  /**
   * List hotels for public search
   */
  async listPublic(query: any) {
    const where: Prisma.HotelWhereInput = { status: 'approved' };

    if (query.city) {
      where.address = { city: { contains: query.city, mode: 'insensitive' } };
    }
    if (query.propertyType) where.propertyType = query.propertyType;
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }
    if (query.minRating) {
      where.avgRating = { gte: query.minRating };
    }

    const orderBy: Prisma.HotelOrderByWithRelationInput = {};
    const sortField = query.sort === 'avg_rating' ? 'avgRating' :
                      query.sort === 'name' ? 'name' : 'createdAt';
    (orderBy as any)[sortField] = query.order || 'desc';

    const page = query.page || 1;
    const limit = query.limit || 10;

    const [items, totalItems] = await Promise.all([
      prisma.hotel.findMany({
        where,
        include: hotelListInclude,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.hotel.count({ where }),
    ]);

    return { items, totalItems, page, limit };
  }

  /**
   * Submit hotel for review (draft → pending)
   */
  async submitForReview(hotelId: string, ownerId: string) {
    const hotel = await this.verifyOwnership(hotelId, ownerId);
    if (hotel.status !== 'draft' && hotel.status !== 'rejected') {
      throw new UnprocessableError(
        'Chỉ có thể gửi duyệt khách sạn ở trạng thái nháp hoặc bị từ chối',
        'HOTEL_INVALID_STATUS'
      );
    }

    return prisma.hotel.update({
      where: { id: hotelId },
      data: { status: 'pending' },
      include: hotelDetailInclude,
    });
  }

  /**
   * Delete hotel (Partner - only if not yet approved)
   */
  async delete(hotelId: string, ownerId: string) {
    const hotel = await this.verifyOwnership(hotelId, ownerId);
    if (hotel.status === 'approved') {
      throw new UnprocessableError(
        'Không thể xóa khách sạn đã được duyệt. Vui lòng liên hệ quản trị viên.',
        'HOTEL_CANNOT_DELETE'
      );
    }

    await prisma.hotel.delete({ where: { id: hotelId } });
    return true;
  }

  // ============================================================
  // IMAGE & VIDEO MANAGEMENT (MinIO)
  // ============================================================

  /**
   * Upload images for a hotel
   */
  async addImages(hotelId: string, ownerId: string, files: Express.Multer.File[]) {
    await this.verifyOwnership(hotelId, ownerId);

    const uploadedFiles = await uploadService.uploadMultiple(
      files, BUCKETS.HOTEL_IMAGES, 'hotel', hotelId, ownerId
    );

    // Get current max sort order
    const maxSort = await prisma.hotelImage.aggregate({
      where: { hotelId },
      _max: { sortOrder: true },
    });
    let sortOrder = (maxSort._max.sortOrder || 0) + 1;

    // Create hotel_images records linked to file_objects
    const images = [];
    for (const file of uploadedFiles) {
      const image = await prisma.hotelImage.create({
        data: {
          hotelId,
          fileId: file.id,
          imageUrl: file.url,
          isCover: sortOrder === 1, // First image is cover by default
          sortOrder: sortOrder++,
          uploadedBy: ownerId,
        },
      });
      images.push({ ...image, file });
    }

    return images;
  }

  /**
   * Remove a hotel image
   */
  async removeImage(hotelId: string, imageId: string, ownerId: string) {
    await this.verifyOwnership(hotelId, ownerId);

    const image = await prisma.hotelImage.findFirst({
      where: { id: imageId, hotelId },
    });
    if (!image) throw new NotFoundError('Không tìm thấy ảnh', 'IMAGE_NOT_FOUND');

    // Soft-delete the file in MinIO
    if (image.fileId) {
      await uploadService.deleteFile(image.fileId, ownerId).catch(() => {});
    }

    // Delete the hotel_images record
    await prisma.hotelImage.delete({ where: { id: imageId } });
    return true;
  }

  /**
   * Upload video for a hotel
   */
  async addVideo(hotelId: string, ownerId: string, file: Express.Multer.File, title?: string) {
    await this.verifyOwnership(hotelId, ownerId);

    const uploadedFile = await uploadService.uploadFile(
      file, BUCKETS.HOTEL_VIDEOS, 'hotel', hotelId, ownerId
    );

    const maxSort = await prisma.hotelVideo.aggregate({
      where: { hotelId },
      _max: { sortOrder: true },
    });

    const video = await prisma.hotelVideo.create({
      data: {
        hotelId,
        fileId: uploadedFile.id,
        videoUrl: uploadedFile.url,
        title: title || file.originalname,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
        uploadedBy: ownerId,
      },
    });

    return { ...video, file: uploadedFile };
  }

  /**
   * Remove a hotel video
   */
  async removeVideo(hotelId: string, videoId: string, ownerId: string) {
    await this.verifyOwnership(hotelId, ownerId);

    const video = await prisma.hotelVideo.findFirst({
      where: { id: videoId, hotelId },
    });
    if (!video) throw new NotFoundError('Không tìm thấy video', 'VIDEO_NOT_FOUND');

    if (video.fileId) {
      await uploadService.deleteFile(video.fileId, ownerId).catch(() => {});
    }

    await prisma.hotelVideo.delete({ where: { id: videoId } });
    return true;
  }
}

export const hotelService = new HotelService();
