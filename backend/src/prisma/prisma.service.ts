import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Wraps PrismaClient as a NestJS provider so it connects on module init
 * and disconnects cleanly on shutdown, and can be injected anywhere via PrismaModule.
 *
 * Prisma 7 requires an explicit driver adapter at runtime (schema.prisma no
 * longer carries the connection URL). DATABASE_URL must already be in
 * process.env by the time this constructs, which holds as long as
 * ConfigModule.forRoot() is the first entry in AppModule's imports.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg(process.env.DATABASE_URL ?? '') });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
