import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RailwayService } from './railway.service';

@Controller('railway')
export class RailwayController {
  constructor(private readonly railwayService: RailwayService) {}

  @Get('status')
  status() {
    return this.railwayService.getState();
  }

  @Post('start')
  @HttpCode(HttpStatus.ACCEPTED)
  start() {
    return this.railwayService.start();
  }

  @Post('stop')
  @HttpCode(HttpStatus.ACCEPTED)
  stop() {
    return this.railwayService.stop();
  }
}
