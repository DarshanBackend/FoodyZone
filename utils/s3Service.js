import s3 from "./s3Config.js";
import { v4 as uuid } from "uuid";
import 'dotenv/config'

export const uploadToS3 = async (file, folder = "uploads") => {
  if (!file) return null;

  const fileKey = `${folder}/${Date.now()}-${uuid()}-${file.originalname.replace(/\s/g, "")}`;

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileKey,
    Body: file.buffer,
    ContentType: file.mimetype
  };

  const upload = await s3.upload(params).promise();
  return upload.Location;
};

export const deleteFromS3 = async (fileKey) => {
  if (!fileKey) return;

  const decodedKey = decodeURIComponent(fileKey);

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: decodedKey
  };

  try {
    const result = await s3.deleteObject(params).promise();
    return result;
  } catch (error) {
    console.error("❌ S3 Delete Error:", error);
    throw error;
  }
};

export const updateS3 = async (oldKey, newFile, folder = "uploads") => {
  if (oldKey) {
    await deleteFromS3(oldKey);
  }
  return await uploadToS3(newFile, folder);
};

export const deleteManyFromS3 = async (keys = []) => {
  if (!keys.length) return;

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Delete: {
      Objects: keys.map(key => ({ Key: key }))
    }
  };

  return await s3.deleteObjects(params).promise();
};

export const listBucketObjects = async () => {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME
  };

  const data = await s3.listObjectsV2(params).promise();

  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_BUCKET_NAME;

  const files = data.Contents.map(file => {
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${file.Key}`;
    return {
      key: file.Key,
      url,
      size: file.Size,
      lastModified: file.LastModified
    };
  });

  return files;
};
