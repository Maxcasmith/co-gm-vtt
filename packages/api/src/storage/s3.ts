import {
  S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, DeleteObjectsCommand, CopyObjectCommand, NotFound,
} from '@aws-sdk/client-s3';
import type { TextStore, MediaStore } from './types.ts';

let client: S3Client | undefined;
function s3(): S3Client {
  client ??= new S3Client(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {});
  return client;
}

function bucket(envVar: string): string {
  const name = process.env[envVar];
  if (!name) throw new Error(`${envVar} must be set to use the s3 storage backend`);
  return name;
}

async function streamToBuffer(body: NodeJS.ReadableStream | ReadableStream | Blob): Promise<Buffer> {
  // @aws-sdk/client-s3's Body is a Node Readable in Node.js runtimes.
  const chunks: Buffer[] = [];
  for await (const chunk of body as NodeJS.ReadableStream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function isNotFound(err: unknown): boolean {
  return err instanceof NotFound || (err as { name?: string })?.name === 'NoSuchKey';
}

function sharedOps(bucketEnvVar: string) {
  return {
    async delete(key: string): Promise<void> {
      await s3().send(new DeleteObjectCommand({ Bucket: bucket(bucketEnvVar), Key: key }));
    },
    async exists(key: string): Promise<boolean> {
      try {
        await s3().send(new HeadObjectCommand({ Bucket: bucket(bucketEnvVar), Key: key }));
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },
    // One level deep, mirroring local's readdir semantics: Delimiter='/' turns S3's flat
    // keyspace into CommonPrefixes (subfolders) + Contents (files) at exactly that level.
    async list(prefix: string): Promise<string[]> {
      const normalized = prefix.endsWith('/') || prefix === '' ? prefix : `${prefix}/`;
      const res = await s3().send(new ListObjectsV2Command({ Bucket: bucket(bucketEnvVar), Prefix: normalized, Delimiter: '/' }));
      const dirs = (res.CommonPrefixes ?? []).map(p => p.Prefix!.slice(normalized.length).replace(/\/$/, ''));
      const files = (res.Contents ?? []).map(c => c.Key!.slice(normalized.length)).filter(Boolean);
      return [...dirs, ...files];
    },
    async copyPrefix(srcPrefix: string, dstPrefix: string): Promise<void> {
      const b = bucket(bucketEnvVar);
      let token: string | undefined;
      do {
        const res = await s3().send(new ListObjectsV2Command({ Bucket: b, Prefix: srcPrefix, ContinuationToken: token }));
        for (const obj of res.Contents ?? []) {
          const dstKey = dstPrefix + obj.Key!.slice(srcPrefix.length);
          await s3().send(new CopyObjectCommand({ Bucket: b, CopySource: `${b}/${obj.Key}`, Key: dstKey }));
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
    },
    async deletePrefix(prefix: string): Promise<void> {
      const b = bucket(bucketEnvVar);
      let token: string | undefined;
      do {
        const res = await s3().send(new ListObjectsV2Command({ Bucket: b, Prefix: prefix, ContinuationToken: token }));
        const keys = (res.Contents ?? []).map(c => ({ Key: c.Key! }));
        if (keys.length) await s3().send(new DeleteObjectsCommand({ Bucket: b, Delete: { Objects: keys } }));
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
    },
  };
}

export const s3TextStore: TextStore = {
  ...sharedOps('S3_TEXT_BUCKET'),
  async get(key: string): Promise<string | null> {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: bucket('S3_TEXT_BUCKET'), Key: key }));
      return (await streamToBuffer(res.Body as NodeJS.ReadableStream)).toString('utf-8');
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },
  async put(key: string, content: string): Promise<void> {
    await s3().send(new PutObjectCommand({ Bucket: bucket('S3_TEXT_BUCKET'), Key: key, Body: content, ContentType: 'application/json' }));
  },
};

export const s3MediaStore: MediaStore = {
  ...sharedOps('S3_MEDIA_BUCKET'),
  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: bucket('S3_MEDIA_BUCKET'), Key: key }));
      return await streamToBuffer(res.Body as NodeJS.ReadableStream);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },
  async put(key: string, data: Buffer): Promise<void> {
    await s3().send(new PutObjectCommand({ Bucket: bucket('S3_MEDIA_BUCKET'), Key: key, Body: data }));
  },
};
