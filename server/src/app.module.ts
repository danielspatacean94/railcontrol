import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { HealthModule } from './common/health/health.module';
import { RailwayModule } from './domain/railway/railway.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', '..', 'dist', 'ui'),
      exclude: ['/api/(.*)'],
    }),
    HealthModule,
    RailwayModule,
  ],
})
export class AppModule {}
