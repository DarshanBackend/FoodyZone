import AWS from "aws-sdk";

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
  region: process.env.AWS_REGION || "ap-south-1"
});

const s3 = new AWS.S3({ signatureVersion: "v4" });

export default s3;
