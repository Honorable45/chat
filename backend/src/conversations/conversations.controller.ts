import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { MAX_IMAGE_SIZE_BYTES } from '../uploads/media-upload.constants';
import { ConversationsService } from './conversations.service';
import { AddMembersDto } from './dto/add-members.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { UpdateConversationMembershipDto } from './dto/update-conversation-membership.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateInviteDto } from './dto/update-invite.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

// Même marge que les uploads d'images ailleurs (avatar, messages) —
// MessagesService/ConversationsService restent la source de vérité pour le
// message d'erreur, Multer ne fait ici qu'une garde-fou générique.
const PHOTO_UPLOAD_LIMITS = { fileSize: MAX_IMAGE_SIZE_BYTES + 1024 };

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  /** Idempotent : renvoie la conversation existante si elle existe déjà. */
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConversationDto) {
    return this.conversations.createDirect(user.userId, dto);
  }

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListConversationsQueryDto) {
    return this.conversations.listMine(user.userId, query);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('group')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', { storage: memoryStorage(), limits: PHOTO_UPLOAD_LIMITS }),
  )
  createGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGroupDto,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ) {
    return this.conversations.createGroup(user.userId, dto, photo);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.conversations.findById(user.userId, id);
  }

  @Patch(':id')
  updateMembership(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationMembershipDto,
  ) {
    return this.conversations.updateMembership(user.userId, id, dto);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Patch(':id/group')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', { storage: memoryStorage(), limits: PHOTO_UPLOAD_LIMITS }),
  )
  updateGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
    @UploadedFile() photo: Express.Multer.File | undefined,
  ) {
    return this.conversations.updateGroup(user.userId, id, dto, photo);
  }

  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get(':id/photo')
  async streamGroupPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const photo = await this.conversations.streamGroupPhoto(user.userId, id);
    res.set({ 'Content-Type': photo.mimeType });
    return new StreamableFile(photo.stream);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':id/members')
  addMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.conversations.addMembers(user.userId, id, dto);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.conversations.removeMember(user.userId, id, targetUserId);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leaveGroup(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.conversations.leaveGroup(user.userId, id);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Patch(':id/members/:userId/role')
  setMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.conversations.setMemberRole(user.userId, id, targetUserId, dto.role);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete(':id/group')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteGroup(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.conversations.deleteGroup(user.userId, id);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':id/invite')
  getOrCreateInvite(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.conversations.getOrCreateInvite(user.userId, id);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':id/invite/reset')
  resetInvite(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.conversations.resetInvite(user.userId, id);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Patch(':id/invite')
  setInviteActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateInviteDto,
  ) {
    return this.conversations.setInviteActive(user.userId, id, dto.isActive);
  }
}
