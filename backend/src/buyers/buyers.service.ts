import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Buyer, BuyerStatus } from './entities/buyer.entity';
import { CreateBuyerDto, SearchBuyerDto } from './dto/buyer.dto';

@Injectable()
export class BuyersService {
  constructor(@InjectRepository(Buyer) private readonly buyerRepo: Repository<Buyer>) {}

  async create(dto: CreateBuyerDto): Promise<Buyer> {
    const buyer = this.buyerRepo.create({ ...dto, country: dto.country ?? 'India' });
    return this.buyerRepo.save(buyer);
  }

  async search(dto: SearchBuyerDto) {
    const qb = this.buyerRepo.createQueryBuilder('buyer');
    if (dto.q) {
      qb.andWhere('(buyer.legalName ILIKE :q OR buyer.email ILIKE :q OR buyer.city ILIKE :q)', {
        q: `%${dto.q}%`,
      });
    }
    if (dto.city) qb.andWhere('buyer.city ILIKE :city', { city: `%${dto.city}%` });
    if (dto.state) qb.andWhere('buyer.state ILIKE :state', { state: `%${dto.state}%` });
    if (dto.status) qb.andWhere('buyer.status = :status', { status: dto.status });
    const [data, total] = await qb.orderBy('buyer.legalName', 'ASC').getManyAndCount();
    return { data, total };
  }

  async findOne(id: string): Promise<Buyer> {
    const buyer = await this.buyerRepo.findOne({ where: { id } });
    if (!buyer) throw new NotFoundException('Buyer not found');
    return buyer;
  }

  /** Sanitized public profile - omits email/phone/contact details. */
  async publicProfile(id: string) {
    const b = await this.findOne(id);
    return {
      id: b.id,
      legalName: b.legalName,
      tradeName: b.tradeName,
      city: b.city,
      state: b.state,
      country: b.country,
      website: b.website,
      logoUrl: b.logoUrl,
      description: b.description,
      procurementCategories: b.procurementCategories,
      verificationStatus: b.verificationStatus,
    };
  }

  async updateStatus(id: string, status: BuyerStatus): Promise<Buyer> {
    const buyer = await this.findOne(id);
    buyer.status = status;
    return this.buyerRepo.save(buyer);
  }
}
