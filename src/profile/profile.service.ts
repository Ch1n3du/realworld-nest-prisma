import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from 'src/db/db.service';
import { extractProfileData, ProfileResponseDto } from './dto/responses.dto';

const SelectProfile = {
  id: true,
  username: true,
  bio: true,
  image: true,
};

@Injectable()
export class ProfileService {
  constructor(private readonly dbService: DbService) { }

  async findByUsername(userId: string, username: string): Promise<ProfileResponseDto> {
    const profile = await this.dbService.user.findFirst({
      where: {
        username: username,
      },
      select: SelectProfile,
    });
    if (profile === null) {
      throw new NotFoundException('User not found');
    }
    const following = await this.isFollowing(userId, profile.id);
    const profileData = extractProfileData({
      ...profile,
      following,
      bio: profile.bio ?? '',
      image: profile.image ?? '',
    });

    return { profile: profileData };
  }

  async followUser(userId: string, username: string): Promise<ProfileResponseDto> {
    const profileId = await this.findIdByUsername(username);
    const following = await this.isFollowing(userId, profileId);
    if (following) {
      return this.findByUsername(userId, username);
    }

    const { followed } = await this.dbService.follows.create({
      data: {
        followerId: userId,
        followedId: profileId,
      },
      select: {
        followed: { select: SelectProfile },
      },
    });
    const profileData = {
      ...followed,
      following: true,
      bio: followed.bio ?? '',
      image: followed.image ?? '',
    };

    return { profile: profileData };
  }

  async unfollowUser(userId: string, username: string): Promise<ProfileResponseDto> {
    const profileId = await this.findIdByUsername(username);

    await this.dbService.follows.delete({
      where: {
        followerId_followedId: { followerId: userId, followedId: profileId },
      },
    });
    return this.findByUsername(userId, username);
  }

  private async findIdByUsername(username: string): Promise<string> {
    const rawId = await this.dbService.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (rawId === null) {
      throw new NotFoundException('User not found');
    }

    return rawId.id;
  }

  private async isFollowing(
    followerId: string,
    followedId: string,
  ): Promise<boolean> {
    const follows = await this.dbService.follows.findFirst({
      where: {
        followerId,
        followedId,
      },
      select: { followedId: true, followerId: true },
    });

    return follows !== null;
  }
}
