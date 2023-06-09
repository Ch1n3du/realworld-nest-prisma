import { TypeOf, z } from 'nestjs-zod/z';
import { createZodDto } from 'nestjs-zod';

const CreateArticleDataSchema = z.object({
  title: z.string().nonempty(),
  description: z.string(),
  body: z.string().nonempty(),
  tagList: z.array(z.string().nonempty()).default([]),
});
export type CreateArticleData = TypeOf<typeof CreateArticleDataSchema>;

const CreateArticleSchema = z.object({
  article: CreateArticleDataSchema
})
export class CreateArticleDto extends createZodDto(CreateArticleSchema) { }
