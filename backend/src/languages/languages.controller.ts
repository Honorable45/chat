import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LanguagesService } from './languages.service';

@ApiTags('languages')
@Controller('languages')
export class LanguagesController {
  constructor(private readonly languages: LanguagesService) {}

  /** Public (pas d'auth requise) : alimente les sélecteurs de langue à l'inscription. */
  @Get()
  findEnabled() {
    return this.languages.findEnabled();
  }
}
