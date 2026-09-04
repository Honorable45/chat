import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ContactsService } from './contacts.service';
import { BlockContactDto } from './dto/block-contact.dto';
import { SendContactRequestDto } from './dto/send-contact-request.dto';
import { ShareContactDto } from './dto/share-contact.dto';

@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.contacts.listContacts(user.userId);
  }

  @Get('requests')
  listRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query('direction') direction?: 'incoming' | 'sent',
  ) {
    return direction === 'sent'
      ? this.contacts.listSentRequests(user.userId)
      : this.contacts.listIncomingRequests(user.userId);
  }

  @Post('requests')
  sendRequest(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendContactRequestDto) {
    return this.contacts.sendRequest(user.userId, dto.userId);
  }

  @Post('requests/:id/accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contacts.accept(user.userId, id);
  }

  @Post('requests/:id/decline')
  decline(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contacts.decline(user.userId, id);
  }

  @Delete('requests/:id')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contacts.cancel(user.userId, id);
  }

  @Post('block')
  block(@CurrentUser() user: AuthenticatedUser, @Body() dto: BlockContactDto) {
    return this.contacts.block(user.userId, dto.userId);
  }

  @Post('unblock')
  unblock(@CurrentUser() user: AuthenticatedUser, @Body() dto: BlockContactDto) {
    return this.contacts.unblock(user.userId, dto.userId);
  }

  // Consulté à chaque carte de contact affichée dans un fil (une par
  // ContactShareCard montée) en plus de chaque visite de profil — même
  // raison que le Throttle sur getByMessage ci-dessous.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('status/:userId')
  statusWith(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string) {
    return this.contacts.statusWith(user.userId, userId);
  }

  @Post('share')
  share(@CurrentUser() user: AuthenticatedUser, @Body() dto: ShareContactDto) {
    return this.contacts.shareContact(user.userId, dto);
  }

  /**
   * Hydratation à la demande d'un message CONTACT_SHARE chargé depuis
   * l'historique — voir CallsController.getByMessage, même raison pour le
   * Throttle généreux (limite par défaut trop basse pour plusieurs cartes
   * de contact dans le même historique).
   */
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('message/:messageId')
  getByMessage(@CurrentUser() user: AuthenticatedUser, @Param('messageId') messageId: string) {
    return this.contacts.getByMessageId(user.userId, messageId);
  }
}
