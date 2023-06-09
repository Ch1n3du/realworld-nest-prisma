import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import slug from 'slug';
import { DbService } from 'src/db/db.service';
import {
  ArticleData,
  ArticleResponseDto,
  AuthorData,
  CommentData,
  CommentResponseDto,
  MultipleArticlesResponseDto,
  MultipleCommentsResponseDto,
  MultipleTagsResponseDto,
} from './dto/responses.dto';
import { CreateArticleData } from './dto/create_article.dto';
import { UpdateArticleData } from './dto/update_article.dto';
import { CreateCommentData } from './dto/create_comment.dto';
import { ListArticleParamsDto } from './dto/list_articles.dto';
import { FeedArticlesParamsDto } from './dto/feed_articles.dto';

@Injectable()
export class ArticleService {
  constructor(private readonly dbService: DbService) { }

  async createArticle(
    userId: string,
    createArticleDto: CreateArticleData,
  ): Promise<ArticleResponseDto> {
    const articleSlug: string = slug(createArticleDto.title);

    await this.createTags(createArticleDto.tagList);
    let articleTitleExists = await this.dbService.article.findFirst({
      where: {
        title: createArticleDto.title
      }
    })
    if (articleTitleExists !== null) {
      throw new UnauthorizedException({ message: 'Unauthorized', body: ['Article title is already in use'] })
    }
    const { id: articleId } = await this.dbService.article.create({
      data: {
        ...createArticleDto,
        tagList: {
          createMany: {
            data: createArticleDto.tagList.map((tagName) => { return { tagName } }),
          },
        },
        slug: articleSlug,
        author: { connect: { id: userId } },
      },
      select: { id: true }
    });

    return this.findArticleBySlug(userId, articleSlug);
  }

  async listArticles(
    userId: string,
    listArticlesParams: ListArticleParamsDto,
  ): Promise<MultipleArticlesResponseDto> {
    const limit = listArticlesParams.limit ?? 20;
    const offset = listArticlesParams.offset ?? 0;
    const favoritedByUserId = listArticlesParams.favorited
      ? await this.findIdByUsername(listArticlesParams.favorited!)
      : undefined;
    const authorId = listArticlesParams.author
      ? await this.findIdByUsername(listArticlesParams.author!)
      : undefined;
    const tag = listArticlesParams.tag ?? undefined;

    const rawArticles = await this.dbService.article.findMany({
      take: limit,
      skip: offset,
      where: {
        authorId: authorId,
      },
      select: {
        ...SelectArticle,
        favorited: {
          where: { userId: favoritedByUserId },
        },
        tagList: {
          where: {
            tagName: tag,
          },
        },
      },
    });

    const formattedArticles: ArticleData[] = [];
    for (const rawArticle of rawArticles) {
      const tagList = rawArticle.tagList.map((rawTag) => {
        return rawTag.tagName;
      });
      const following = await this.isFollowing(userId, rawArticle.author.id);
      const author: AuthorData = {
        username: rawArticle.author.username ?? '',
        bio: rawArticle.author.bio ?? '',
        image: rawArticle.author.image ?? '',
        following: following,
      };
      const favoritesCount = rawArticle.favorited.length;
      const favorited = rawArticle.favorited.some(
        (favorite) => favorite.userId === userId,
      );

      const articleData: ArticleData = {
        ...rawArticle,
        author,
        tagList,
        favorited,
        favoritesCount,
      };
      formattedArticles.push(articleData);
    }

    return {
      articles: formattedArticles,
      articlesCount: formattedArticles.length,
    };
  }

  async feedArticles(
    userId: string,
    feedArticlesParams: FeedArticlesParamsDto,
  ): Promise<MultipleArticlesResponseDto> {
    return this.listArticles(userId, feedArticlesParams);
  }

  async findArticleBySlug(
    userId: string,
    articleSlug: string,
  ): Promise<ArticleResponseDto> {
    const rawArticle = await this.dbService.article.findUnique({
      where: { slug: articleSlug },
      select: SelectArticle,
    });
    if (rawArticle === null) {
      throw new NotFoundException('Article not found');
    }

    const tagList = rawArticle.tagList.map((rawTag) => {
      return rawTag.tagName;
    });
    const following = await this.isFollowing(userId, rawArticle.author.id);
    const author: AuthorData = {
      username: rawArticle.author.username ?? '',
      bio: rawArticle.author.bio ?? '',
      image: rawArticle.author.image ?? '',
      following: following,
    };
    const favoritesCount = rawArticle.favorited.length;
    const favorited = rawArticle.favorited.some(
      (favorite) => favorite.userId === userId,
    );

    const articleData: ArticleData = {
      ...rawArticle,
      author,
      tagList,
      favorited,
      favoritesCount,
    };

    return { article: articleData };
  }

  async updateArticle(
    userId: string,
    articleSlug: string,
    updateArticleDto: UpdateArticleData,
  ) {
    const newSlug = updateArticleDto.title
      ? slug(updateArticleDto.title)
      : undefined;
    if (newSlug !== undefined && await this.slugInUse(newSlug)) {
      throw new UnauthorizedException({ message: 'Article title is already in use', body: [] })
    }
    try {
      await this.dbService.article.update({
        data: {
          ...updateArticleDto,
          slug: newSlug,
        },
        where: { slug: articleSlug },
      });
    } catch (_) { }

    return this.findArticleBySlug(userId, articleSlug);
  }

  async deleteArticle(userId: string, articleSlug: string) {
    await this.dbService.articleToTag.deleteMany({
      where: {
        articleId: await this.findArticleIdBySlug(articleSlug)
      }
    })
    const articleRes = await this.dbService.article.delete({
      where: {
        slug: articleSlug,
      },
      select: { id: true, authorId: true },
    });
    if (articleRes === null) {
      throw new NotFoundException('Article not found');
    }
    const { id, authorId } = articleRes;

    if (userId !== authorId) {
      throw new UnauthorizedException();
    }
    await this.dbService.articleToTag.deleteMany({
      where: { articleId: id },
    });
    await this.dbService.comment.deleteMany({
      where: { articleId: id },
    });
    await this.dbService.favorites.deleteMany({
      where: { articleId: id },
    });
  }

  async createComment(
    userId: string,
    slug: string,
    createCommentDto: CreateCommentData,
  ): Promise<CommentResponseDto> {
    const comment = await this.dbService.comment.create({
      data: {
        author: {
          connect: { id: userId },
        },
        article: {
          connect: {
            id: await this.findArticleIdBySlug(slug),
          }
        },
        body: createCommentDto.body,
      },
      select: SelectComment,
    });
    const following = await this.isFollowing(userId, comment.author.id);
    const author = {
      username: comment.author.username,
      bio: comment.author.bio ?? '',
      image: comment.author.image ?? '',
      following,
    };

    return { comment: { ...comment, author } };
  }

  async findCommentsByArticle(
    userId: string,
    articleSlug: string,
  ): Promise<MultipleCommentsResponseDto> {
    const articleId = await this.findArticleIdBySlug(articleSlug);
    const rawComments = await this.dbService.comment.findMany({
      where: {
        articleId: articleId,
      },
      select: SelectComment,
    });

    const formattedComments: CommentData[] = [];
    for (const rawComment of rawComments) {
      const following = await this.isFollowing(userId, rawComment.author.id);
      const author = {
        username: rawComment.author.username,
        bio: rawComment.author.bio ?? '',
        image: rawComment.author.image ?? '',
        following,
      };

      formattedComments.push({ ...rawComment, author });
    }

    return { comments: formattedComments };
  }

  async deleteComment(userId: string, commentId: number) {
    const commentAuthorId = await this.dbService.comment.findFirst({
      where: {
        id: commentId,
      },
      select: { authorId: true },
    });
    if (commentAuthorId === null) {
      return;
    }
    if (commentAuthorId.authorId !== userId) {
      throw new UnauthorizedException();
    }
    await this.dbService.comment.delete({
      where: {
        id: commentId,
      },
    });
  }

  async favoriteArticle(userId: string, articleSlug): Promise<ArticleResponseDto> {
    const articleId = await this.findArticleIdBySlug(articleSlug);
    try {
      // Try catch in case of duplicate entries
      // Should be faster than manually checking
      this.dbService.favorites.create({
        data: {
          articleId: articleId,
          userId: userId,
        },
      });
    } catch (_) { }
    return this.findArticleBySlug(userId, articleSlug);
  }
  async unfavoriteArticle(
    userId: string,
    articleSlug,
  ): Promise<ArticleResponseDto> {
    const articleId = await this.findArticleIdBySlug(articleSlug);
    this.dbService.favorites.delete({
      where: {
        userId_articleId: {
          userId: userId,
          articleId: articleId,
        },
      },
    });
    return this.findArticleBySlug(userId, articleSlug);
  }

  async getTags(): Promise<MultipleTagsResponseDto> {
    const rawTags = await this.dbService.tag.findMany();
    const tags = rawTags.map(({ name }) => name);
    return { tags };
  }

  ///==============================================///
  ///                Helper Methods                ///
  ///==============================================///

  private async createTags(tags: string[]) {
    try {
      await this.dbService.tag.createMany({
        data: tags.map((tagName) => {
          return { name: tagName };
        }),
      });
    } catch (_) { }
  }

  private async slugInUse(articleSlug: string): Promise<boolean> {
    const exists = await this.dbService.article.findFirst({
      where: { slug: articleSlug },
      select: { slug: true },
    });

    return exists !== undefined;
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
      select: { followedId: true },
    });

    return follows !== null;
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

  private async findArticleIdBySlug(articleSlug: string): Promise<string> {
    const rawUserId = await this.dbService.article.findFirst({
      where: { slug: articleSlug },
      select: { id: true },
    });
    if (rawUserId === null) {
      throw new NotFoundException('Article not found');
    }
    return rawUserId.id;
  }
}

const SelectArticle = {
  slug: true,
  title: true,
  description: true,
  body: true,
  tagList: true,
  createdAt: true,
  updatedAt: true,
  favorited: true,
  author: {
    select: {
      id: true,
      username: true,
      bio: true,
      image: true,
    },
  },
};

const SelectComment = {
  id: true,
  createdAt: true,
  updatedAt: true,
  body: true,
  author: {
    select: {
      id: true,
      username: true,
      bio: true,
      image: true,
    },
  },
};
