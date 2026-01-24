import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import multer from "multer";
import {
  v2 as cloudinary,
  type UploadApiErrorResponse,
  type UploadApiResponse,
} from "cloudinary";
import { Readable } from "stream";
import "dotenv/config";
import {
  createUser,
  findOrCreateUserWithOAuth,
  findUserByEmail,
  getMessagesForRoom,
  getUserById,
  initDb,
  saveMessage,
  addFriendForUser,
  getFriendsForUser,
  blockUserForUser,
  unblockUserForUser,
  getBlockedUsersForUser,
  editMessageForUser,
  softDeleteMessageForUser,
  getReactionsForMessages,
  addReactionForUser,
  removeReactionForUser,
  getReadReceiptsForRoom,
  upsertReadReceipt,
  getMessageCountForRoom,
  getUnreadCountsForUser,
  getMentionUnreadCountsForUser,
  createChannelForUser,
  getChannelsForUser,
  addUserToChannel,
  createFeedback,
  getRecentFeedbackWithUsers,
  createPasswordResetTokenForUser,
  findValidPasswordResetToken,
  markPasswordResetTokenUsed,
  updateUserPassword,
  createEmailVerificationCodeForUser,
  findValidEmailVerificationCodeForUser,
  markEmailVerificationCodeUsed,
  markUserEmailVerified,
  getAttachmentsForMessages,
  createMessageAttachments,
  assignAttachmentsToMessage,
  getChannelParticipantRole,
  updateChannelParticipantRole,
  getChannelMembers,
  removeUserFromChannel,
  deleteChannelById,
  updateUserProfile,
  searchUsers,
  type StoredMessage,
} from "./db";
import {
  authMiddleware,
  hashPassword,
  signAccessToken,
  verifyPassword,
  verifyToken,
  hasGlobalRoleAtLeast,
  type AuthenticatedRequest,
} from "./auth";
import { sendPasswordResetEmail, sendVerificationCodeEmail } from "./email";

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const multerStorage = multer.memoryStorage();
const upload = multer({
  storage: multerStorage,
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 10,
  },
});

const uploadMiddleware = upload.array("files", 10);

function uploadBufferToCloudinary(file: Express.Multer.File) {
  return new Promise<{
    url: string;
    publicId: string;
    mimeType: string;
    fileSize: number;
    originalFilename: string;
  }>((resolve, reject) => {
    const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || "pulsechat";

    let resourceType: "image" | "video" | "raw" | "auto" = "auto";
    if (
      file.mimetype === "application/pdf" ||
      file.mimetype.startsWith("application/")
    ) {
      resourceType = "raw";
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
      },
      (
        error: UploadApiErrorResponse | undefined,
        result: UploadApiResponse | undefined
      ) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload failed"));
          return;
        }

        resolve({
          url: result.secure_url ?? result.url,
          publicId: result.public_id,
          mimeType: file.mimetype,
          fileSize: file.size,
          originalFilename: file.originalname,
        });
      }
    );

    Readable.from(file.buffer).pipe(uploadStream);
  });
}

app.post("/auth/register", async (req, res) => {
  const { email, password, displayName } = req.body as {
    email?: string;
    password?: string;
    displayName?: string;
  };

  if (!email || !password || !displayName) {
    return res
      .status(400)
      .json({ error: "email, password and displayName are required" });
  }

  const normalizedEmail = email.toLowerCase();

  if (
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return res.status(400).json({
      error:
        "Password must be at least 8 characters and include both letters and numbers",
    });
  }

  try {
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: "Email is already in use" });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({
      email: normalizedEmail,
      displayName,
      passwordHash,
    });

    try {
      const verification = await createEmailVerificationCodeForUser({
        userId: user.id,
      });
      await sendVerificationCodeEmail({
        to: user.email,
        code: verification.code,
      });
    } catch (error) {
      console.error("Failed to generate or send verification email", error);
    }

    return res.status(201).json({
      message:
        "Registration successful. Please check your email for a 6-digit verification code to activate your account.",
      verificationRequired: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        status: user.status,
        globalRole: user.global_role,
      },
    });
  } catch (error) {
    console.error("Failed to register user", error);
    return res.status(500).json({ error: "Failed to register user" });
  }
});

app.get(
  "/users/search",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const q = (req.query.q as string | undefined) ?? "";
    const query = q.trim();
    if (!query) {
      return res
        .status(400)
        .json({ error: "Query parameter 'q' is required" });
    }

    let limit = 20;
    const limitRaw = req.query.limit as string | undefined;
    if (limitRaw) {
      const parsed = Number.parseInt(limitRaw, 10);
      if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 100) {
        limit = parsed;
      }
    }

    const emailVerifiedOnlyRaw = req.query.emailVerifiedOnly as
      | string
      | undefined;
    const emailVerifiedOnly =
      emailVerifiedOnlyRaw === "false" || emailVerifiedOnlyRaw === "0"
        ? false
        : true;

    const channelId = req.query.channelId as string | undefined;

    try {
      const users = await searchUsers({
        query,
        limit,
        excludeUserId: userId,
        emailVerifiedOnly,
        excludeBannedForConversationId: channelId,
      });

      return res.json({
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.display_name,
          avatarUrl: u.avatar_url,
        })),
      });
    } catch (error) {
      console.error("Failed to search users", error);
      return res.status(500).json({ error: "Failed to search users" });
    }
  }
);

app.post(
  "/uploads",
  authMiddleware,
  (req: AuthenticatedRequest, res, next) => {
    uploadMiddleware(req as any, res as any, (err: any) => {
      if (err) {
        if (
          err instanceof multer.MulterError &&
          err.code === "LIMIT_FILE_SIZE"
        ) {
          return res
            .status(400)
            .json({ error: "Each file must be 25MB or smaller" });
        }
        console.error("Failed to process uploaded files", err);
        return res
          .status(400)
          .json({ error: "Failed to process uploaded files" });
      }
      next();
    });
  },
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return res
        .status(500)
        .json({ error: "File uploads are not configured on the server" });
    }

    const files = (req.files ?? []) as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "At least one file is required" });
    }

    try {
      const uploads = [] as {
        url: string;
        publicId: string;
        mimeType: string;
        fileSize: number;
        originalFilename: string;
      }[];

      for (const file of files) {
        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
          return res
            .status(400)
            .json({ error: "Each file must be 25MB or smaller" });
        }

        const result = await uploadBufferToCloudinary(file);
        uploads.push(result);
      }

      const created = await createMessageAttachments({
        uploaderUserId: userId,
        uploads: uploads.map((u) => ({
          url: u.url,
          publicId: u.publicId,
          mimeType: u.mimeType,
          fileSize: u.fileSize,
          originalFilename: u.originalFilename,
        })),
      });

      return res.status(201).json({
        attachments: created.map((a) => ({
          id: a.id,
          url: a.url,
          mimeType: a.mime_type,
          fileSize: a.file_size,
          originalFilename: a.original_filename,
        })),
      });
    } catch (error) {
      console.error("Failed to upload files", error);
      return res.status(500).json({ error: "Failed to upload files" });
    }
  }
);

app.post("/auth/verify-email", async (req, res) => {
  const { email, code } = req.body as { email?: string; code?: string };

  if (!email || !code) {
    return res.status(400).json({ error: "email and code are required" });
  }

  const normalizedEmail = email.toLowerCase();

  try {
    const user = await findUserByEmail(normalizedEmail);
    if (!user) {
      return res
        .status(400)
        .json({ error: "Invalid verification code or email" });
    }

    if (user.email_verified) {
      const token = signAccessToken(user);
      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          status: user.status,
          globalRole: user.global_role,
        },
      });
    }

    const verificationRow = await findValidEmailVerificationCodeForUser({
      userId: user.id,
      code,
    });

    if (!verificationRow) {
      return res
        .status(400)
        .json({ error: "Invalid or expired verification code" });
    }

    await markEmailVerificationCodeUsed(verificationRow.id);
    await markUserEmailVerified(user.id);
    const updatedUser = await getUserById(user.id);
    const finalUser = updatedUser ?? user;

    const token = signAccessToken(finalUser);

    return res.json({
      token,
      user: {
        id: finalUser.id,
        email: finalUser.email,
        displayName: finalUser.display_name,
        avatarUrl: finalUser.avatar_url,
        status: finalUser.status,
        globalRole: finalUser.global_role,
      },
    });
  } catch (error) {
    console.error("Failed to verify email", error);
    return res.status(500).json({ error: "Failed to verify email" });
  }
});

app.post("/auth/resend-verification", async (req, res) => {
  const { email } = req.body as { email?: string };

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  const normalizedEmail = email.toLowerCase();

  try {
    const user = await findUserByEmail(normalizedEmail);

    if (!user) {
      return res.json({
        message:
          "If an account with that email exists and is not verified, a verification email has been sent.",
      });
    }

    if (user.email_verified) {
      return res.json({ message: "Email is already verified." });
    }

    try {
      const verification = await createEmailVerificationCodeForUser({
        userId: user.id,
      });
      await sendVerificationCodeEmail({
        to: user.email,
        code: verification.code,
      });
    } catch (error) {
      console.error("Failed to create or send verification email", error);
    }

    return res.json({
      message:
        "If an account with that email exists and is not verified, a verification email has been sent.",
    });
  } catch (error) {
    console.error("Failed to resend verification email", error);
    return res
      .status(500)
      .json({ error: "Failed to resend verification email" });
  }
});

app.get("/channels", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const channels = await getChannelsForUser(userId);
    return res.json({
      channels: channels.map((ch) => ({
        id: ch.id,
        title: ch.title,
        slug: ch.slug,
        isPublic: ch.is_public,
        createdBy: ch.created_by,
        participantRole: ch.participant_role ?? null,
      })),
    });
  } catch (error) {
    console.error("Failed to load channels for user", error);
    return res.status(500).json({ error: "Failed to load channels" });
  }
});

app.post(
  "/channels",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Channel name is required" });
    }

    try {
      const channel = await createChannelForUser({ userId, name });
      return res.status(201).json({
        channel: {
          id: channel.id,
          title: channel.title,
          slug: channel.slug,
          isPublic: channel.is_public,
          createdBy: channel.created_by,
        },
      });
    } catch (error) {
      console.error("Failed to create channel", error);
      return res.status(500).json({ error: "Failed to create channel" });
    }
  }
);

app.post(
  "/channels/:channelId/invite",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const channelId = req.params.channelId as string;
    const { userId: targetUserId, displayName } = req.body as {
      userId?: string;
      displayName?: string;
    };

    if (!targetUserId || !displayName) {
      return res
        .status(400)
        .json({ error: "userId and displayName are required" });
    }

    // Basic sanity check to avoid Postgres UUID parsing errors for obviously invalid IDs
    const trimmedTargetId = targetUserId.trim();
    const looksLikeUuid = /^[0-9a-fA-F-]{36}$/.test(trimmedTargetId);
    if (!looksLikeUuid) {
      return res.status(400).json({ error: "Invalid userId format" });
    }

    try {
      const role = await getChannelParticipantRole({ channelId, userId });
      if (role !== "owner") {
        return res
          .status(403)
          .json({ error: "Only the channel owner can invite members" });
      }

      const targetUser = await getUserById(trimmedTargetId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (targetUser.id === userId) {
        return res.status(400).json({ error: "You cannot invite yourself" });
      }

      if (
        targetUser.display_name.toLowerCase() !==
        displayName.trim().toLowerCase()
      ) {
        return res
          .status(400)
          .json({ error: "User ID and display name do not match" });
      }

      await addUserToChannel({ channelId, userId: targetUser.id });
      return res.status(204).send();
    } catch (error) {
      console.error("Failed to invite user to channel", error);
      return res
        .status(500)
        .json({ error: "Failed to invite user to channel" });
    }
  }
);

app.get(
  "/channels/:channelId/members",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const channelId = req.params.channelId as string;

    try {
      const role = await getChannelParticipantRole({ channelId, userId });
      if (!role) {
        return res
          .status(403)
          .json({ error: "You are not a member of this channel" });
      }

      const members = await getChannelMembers(channelId);
      return res.json({
        members: members.map((m) => ({
          id: m.user_id,
          email: m.email,
          displayName: m.display_name,
          role: m.role,
          isSelf: m.user_id === userId,
        })),
      });
    } catch (error) {
      console.error("Failed to load channel members", error);
      return res.status(500).json({ error: "Failed to load channel members" });
    }
  }
);

app.delete(
  "/channels/:channelId/members/:memberId",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const channelId = req.params.channelId as string;
    const memberId = req.params.memberId as string;

    if (memberId === userId) {
      return res
        .status(400)
        .json({ error: "Use the leave-channel action to remove yourself" });
    }

    try {
      const role = await getChannelParticipantRole({ channelId, userId });
      if (role !== "owner") {
        return res
          .status(403)
          .json({ error: "Only the channel owner can remove channel members" });
      }

      const targetRole = await getChannelParticipantRole({
        channelId,
        userId: memberId,
      });
      if (!targetRole) {
        return res
          .status(404)
          .json({ error: "User is not a member of this channel" });
      }

      if (targetRole === "owner") {
        return res
          .status(400)
          .json({ error: "You cannot remove another owner" });
      }

      await removeUserFromChannel({ channelId, userId: memberId });
      return res.status(204).send();
    } catch (error) {
      console.error("Failed to remove user from channel", error);
      return res
        .status(500)
        .json({ error: "Failed to remove user from channel" });
    }
  }
);

app.patch(
  "/channels/:channelId/members/:memberId/role",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const channelId = req.params.channelId as string;
    const memberId = req.params.memberId as string;
    const { role } = req.body as { role?: string };

    if (!role || (role !== "member" && role !== "moderator")) {
      return res
        .status(400)
        .json({ error: "role must be 'member' or 'moderator'" });
    }

    if (memberId === userId) {
      return res
        .status(400)
        .json({ error: "You cannot change your own role in this channel" });
    }

    try {
      const callerRole = await getChannelParticipantRole({ channelId, userId });
      if (callerRole !== "owner") {
        return res
          .status(403)
          .json({ error: "Only the channel owner can change member roles" });
      }

      const targetRole = await getChannelParticipantRole({
        channelId,
        userId: memberId,
      });
      if (!targetRole) {
        return res
          .status(404)
          .json({ error: "User is not a member of this channel" });
      }

      if (targetRole === "owner") {
        return res
          .status(400)
          .json({ error: "You cannot change the role of an owner" });
      }

      const updated = await updateChannelParticipantRole({
        channelId,
        userId: memberId,
        role,
      });

      if (!updated) {
        return res
          .status(500)
          .json({ error: "Failed to update member role" });
      }

      return res.status(204).send();
    } catch (error) {
      console.error("Failed to update channel member role", error);
      return res
        .status(500)
        .json({ error: "Failed to update channel member role" });
    }
  }
);

app.delete(
  "/channels/:channelId",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const channelId = req.params.channelId as string;

    try {
      const role = await getChannelParticipantRole({ channelId, userId });
      if (role !== "owner") {
        return res.status(403).json({
          error: "Only the channel owner can delete this channel",
        });
      }

      const deleted = await deleteChannelById(channelId);
      if (!deleted) {
        return res.status(404).json({ error: "Channel not found" });
      }

      return res.status(204).send();
    } catch (error) {
      console.error("Failed to delete channel", error);
      return res.status(500).json({ error: "Failed to delete channel" });
    }
  }
);

app.post(
  "/channels/:channelId/leave",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const channelId = req.params.channelId as string;

    try {
      const role = await getChannelParticipantRole({ channelId, userId });
      if (!role) {
        return res
          .status(403)
          .json({ error: "You are not a member of this channel" });
      }

      if (role === "owner") {
        return res.status(400).json({
          error:
            "Channel owners cannot leave their own channel. Transfer ownership or delete the channel instead.",
        });
      }

      await removeUserFromChannel({ channelId, userId });
      return res.status(204).send();
    } catch (error) {
      console.error("Failed to leave channel", error);
      return res
        .status(500)
        .json({ error: "Failed to leave channel" });
    }
  }
);

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const normalizedEmail = email.toLowerCase();
  const user = await findUserByEmail(normalizedEmail);

  if (!user || !user.password_hash) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (!user.email_verified) {
    return res.status(403).json({
      error:
        "Your email address has not been verified yet. Please check your email for a verification code.",
    });
  }

  const token = signAccessToken(user);

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      status: user.status,
      globalRole: user.global_role,
    },
  });
});

app.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body as { email?: string };

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  const normalizedEmail = email.toLowerCase();

  try {
    const user = await findUserByEmail(normalizedEmail);

    if (user) {
      try {
        const reset = await createPasswordResetTokenForUser({
          userId: user.id,
        });
        try {
          await sendPasswordResetEmail({ to: user.email, token: reset.token });
        } catch (error) {
          console.error("Failed to send password reset email", error);
        }
      } catch (error) {
        console.error("Failed to create password reset token", error);
        // Intentionally fall through to generic success message so we do not leak state.
      }
    }

    return res.json({
      message:
        "If an account with that email exists, a reset token has been generated.",
    });
  } catch (error) {
    console.error("Failed to initiate password reset", error);
    return res.status(500).json({ error: "Failed to initiate password reset" });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };

  if (!token || !password) {
    return res.status(400).json({ error: "token and password are required" });
  }

  if (
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return res.status(400).json({
      error:
        "Password must be at least 8 characters and include both letters and numbers",
    });
  }

  try {
    const resetRow = await findValidPasswordResetToken(token);
    if (!resetRow) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    const user = await getUserById(resetRow.user_id);
    if (!user) {
      return res.status(400).json({ error: "Invalid reset token" });
    }

    const passwordHash = await hashPassword(password);
    await updateUserPassword({ userId: user.id, passwordHash });
    await markPasswordResetTokenUsed(resetRow.id);

    return res.json({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Failed to reset password", error);
    return res.status(500).json({ error: "Failed to reset password" });
  }
});

app.post("/auth/oauth", async (req, res) => {
  const { provider, providerAccountId, email, displayName } = req.body as {
    provider?: string;
    providerAccountId?: string;
    email?: string;
    displayName?: string;
  };

  if (!provider || !providerAccountId || !email || !displayName) {
    return res
      .status(400)
      .json({
        error:
          "provider, providerAccountId, email and displayName are required",
      });
  }

  const normalizedEmail = email.toLowerCase();
  const user = await findOrCreateUserWithOAuth({
    provider,
    providerAccountId,
    email: normalizedEmail,
    displayName,
  });

  const token = signAccessToken(user);

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      globalRole: user.global_role,
    },
  });
});

app.get("/auth/me", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      status: user.status,
      globalRole: user.global_role,
    },
  });
});

app.patch(
  "/me/profile",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { displayName, status } = req.body as {
      displayName?: string;
      status?: string | null;
    };

    if (
      displayName != null &&
      typeof displayName === "string" &&
      !displayName.trim()
    ) {
      return res
        .status(400)
        .json({ error: "displayName, if provided, must not be empty" });
    }

    try {
      const updated = await updateUserProfile({
        userId,
        displayName,
        status: status ?? null,
      });

      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.json({
        user: {
          id: updated.id,
          email: updated.email,
          displayName: updated.display_name,
          avatarUrl: updated.avatar_url,
          status: updated.status,
          globalRole: updated.global_role,
        },
      });
    } catch (error) {
      console.error("Failed to update profile", error);
      return res.status(500).json({ error: "Failed to update profile" });
    }
  }
);

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

app.post(
  "/me/avatar",
  authMiddleware,
  (req: AuthenticatedRequest, res, next) => {
    avatarUpload.single("file")(req as any, res as any, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res
            .status(400)
            .json({ error: "Avatar must be 5MB or smaller" });
        }
        console.error("Failed to process avatar upload", err);
        return res
          .status(400)
          .json({ error: "Failed to process avatar upload" });
      }
      next();
    });
  },
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return res
        .status(500)
        .json({ error: "File uploads are not configured on the server" });
    }

    const file = (req.file ?? null) as Express.Multer.File | null;
    if (!file) {
      return res.status(400).json({ error: "Avatar file is required" });
    }

    try {
      const upload = await uploadBufferToCloudinary(file);

      const updated = await updateUserProfile({
        userId,
        avatarUrl: upload.url,
      });

      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.json({
        user: {
          id: updated.id,
          email: updated.email,
          displayName: updated.display_name,
          avatarUrl: updated.avatar_url,
          status: updated.status,
          globalRole: updated.global_role,
        },
      });
    } catch (error) {
      console.error("Failed to upload avatar", error);
      return res.status(500).json({ error: "Failed to upload avatar" });
    }
  }
);

app.get("/friends", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const friends = await getFriendsForUser(userId);
    return res.json({
      friends: friends.map((f) => ({
        id: f.id,
        email: f.email,
        displayName: f.display_name,
        avatarUrl: f.avatar_url,
      })),
    });
  } catch (error) {
    console.error("Failed to load friends", error);
    return res.status(500).json({ error: "Failed to load friends" });
  }
});

app.get(
  "/me/unread-counts",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const [rows, mentionRows] = await Promise.all([
        getUnreadCountsForUser(userId),
        getMentionUnreadCountsForUser(userId),
      ]);

      const byRoom: Record<string, number> = {};
      for (const row of rows) {
        byRoom[row.room] = row.unread_count;
      }

      const mentionByRoom: Record<string, number> = {};
      for (const row of mentionRows) {
        mentionByRoom[row.room] = row.unread_count;
      }

      return res.json({
        unreadCounts: byRoom,
        mentionUnreadCounts: mentionByRoom,
      });
    } catch (error) {
      console.error("Failed to load unread counts", error);
      return res.status(500).json({ error: "Failed to load unread counts" });
    }
  }
);

app.post("/friends", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { friendId, friendDisplayName } = req.body as {
    friendId?: string;
    friendDisplayName?: string;
  };

  if (!friendId || !friendDisplayName) {
    return res
      .status(400)
      .json({ error: "friendId and friendDisplayName are required" });
  }
  if (friendId === userId) {
    return res
      .status(400)
      .json({ error: "You cannot add yourself as a friend" });
  }

  try {
    const friendUser = await getUserById(friendId);
    if (!friendUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (friendUser.display_name !== friendDisplayName) {
      return res
        .status(400)
        .json({ error: "Display name does not match this user id" });
    }

    await addFriendForUser({ userId, friendUserId: friendId });
    await addFriendForUser({ userId: friendId, friendUserId: userId });

    return res.status(201).json({
      friend: {
        id: friendUser.id,
        email: friendUser.email,
        displayName: friendUser.display_name,
        avatarUrl: friendUser.avatar_url,
      },
    });
  } catch (error) {
    console.error("Failed to add friend", error);
    return res.status(500).json({ error: "Failed to add friend" });
  }
});

app.get(
  "/me/blocked-users",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const blocked = await getBlockedUsersForUser(userId);
      return res.json({
        blocked: blocked.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.display_name,
          avatarUrl: u.avatar_url,
        })),
      });
    } catch (error) {
      console.error("Failed to load blocked users", error);
      return res
        .status(500)
        .json({ error: "Failed to load blocked users" });
    }
  }
);

app.post(
  "/me/blocked-users",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { targetUserId, displayName } = req.body as {
      targetUserId?: string;
      displayName?: string;
    };

    if (!targetUserId || !displayName) {
      return res
        .status(400)
        .json({ error: "targetUserId and displayName are required" });
    }
    if (targetUserId === userId) {
      return res
        .status(400)
        .json({ error: "You cannot block yourself" });
    }

    try {
      const targetUser = await getUserById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (targetUser.display_name !== displayName) {
        return res
          .status(400)
          .json({ error: "Display name does not match this user id" });
      }

      await blockUserForUser({ userId, blockedUserId: targetUserId });

      return res.status(201).json({
        blocked: {
          id: targetUser.id,
          email: targetUser.email,
          displayName: targetUser.display_name,
          avatarUrl: targetUser.avatar_url,
        },
      });
    } catch (error) {
      console.error("Failed to block user", error);
      return res.status(500).json({ error: "Failed to block user" });
    }
  }
);

app.delete(
  "/me/blocked-users/:blockedUserId",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const blockedUserId = req.params.blockedUserId as string;

    if (blockedUserId === userId) {
      return res
        .status(400)
        .json({ error: "You cannot unblock yourself" });
    }

    try {
      await unblockUserForUser({ userId, blockedUserId });
      return res.status(204).send();
    } catch (error) {
      console.error("Failed to unblock user", error);
      return res.status(500).json({ error: "Failed to unblock user" });
    }
  }
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post(
  "/feedback",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { category, message } = req.body as {
      category?: string | null;
      message?: string;
    };

    const trimmed = (message ?? "").trim();
    if (!trimmed) {
      return res.status(400).json({ error: "Feedback message is required" });
    }

    try {
      const created = await createFeedback({
        userId,
        category: category ?? null,
        message: trimmed,
      });

      return res.status(201).json({
        feedback: {
          id: created.id,
          userId: created.user_id,
          category: created.category,
          message: created.message,
          createdAt: created.created_at.toISOString(),
        },
      });
    } catch (error) {
      console.error("Failed to save feedback", error);
      return res.status(500).json({ error: "Failed to save feedback" });
    }
  }
);

app.get(
  "/admin/feedback",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const user = await getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!hasGlobalRoleAtLeast(user.global_role, "admin")) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const limitParam = req.query.limit;
      const limit =
        typeof limitParam === "string" &&
        !Number.isNaN(Number.parseInt(limitParam, 10))
          ? Number.parseInt(limitParam, 10)
          : 100;

      const rows = await getRecentFeedbackWithUsers(limit);

      return res.json({
        feedback: rows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          userEmail: row.user_email,
          userDisplayName: row.user_display_name,
          category: row.category,
          message: row.message,
          createdAt: row.created_at.toISOString(),
        })),
      });
    } catch (error) {
      console.error("Failed to load feedback for admin", error);
      return res.status(500).json({ error: "Failed to load feedback" });
    }
  }
);

app.get("/rooms/:room/messages", async (req, res) => {
  const room = req.params.room;
  const limitParam = req.query.limit;
  const limit =
    typeof limitParam === "string" &&
    !Number.isNaN(Number.parseInt(limitParam, 10))
      ? Number.parseInt(limitParam, 10)
      : 50;

  try {
    const rows = await getMessagesForRoom(room, limit);
    const messageIds = rows.map((row) => row.id);
    const [reactionRows, readRows, totalCount, attachmentRows] =
      await Promise.all([
        getReactionsForMessages(messageIds),
        getReadReceiptsForRoom(room),
        getMessageCountForRoom(room),
        getAttachmentsForMessages(messageIds),
      ]);

    const reactionsByMessage = new Map<
      number,
      { emoji: string; userId: string }[]
    >();

    for (const r of reactionRows) {
      const existing = reactionsByMessage.get(r.message_id) ?? [];
      existing.push({ emoji: r.emoji, userId: r.user_id });
      reactionsByMessage.set(r.message_id, existing);
    }

    const attachmentsByMessage = new Map<
      number,
      {
        id: number;
        url: string;
        mimeType: string | null;
        fileSize: number | null;
        originalFilename: string | null;
      }[]
    >();

    for (const a of attachmentRows) {
      if (!a.message_id) continue;
      const existing = attachmentsByMessage.get(a.message_id) ?? [];
      existing.push({
        id: a.id,
        url: a.url,
        mimeType: a.mime_type,
        fileSize: a.file_size,
        originalFilename: a.original_filename,
      });
      attachmentsByMessage.set(a.message_id, existing);
    }

    const messages = rows.map((row: StoredMessage) => ({
      id: row.id,
      room: row.room,
      user: row.username,
      message: row.message,
      timestamp: row.created_at.toISOString(),
      userId: row.user_id,
      replyToMessageId: row.reply_to_message_id,
      editedAt: row.edited_at ? row.edited_at.toISOString() : null,
      deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
      deletedByUserId: row.deleted_by,
      reactions: reactionsByMessage.get(row.id) ?? [],
      attachments: attachmentsByMessage.get(row.id) ?? [],
    }));
    const readReceipts = readRows.map((r) => ({
      room: r.room,
      userId: r.user_id,
      lastReadMessageId: r.last_read_message_id,
      updatedAt: r.updated_at.toISOString(),
    }));

    res.json({ messages, totalCount, readReceipts });
  } catch (error) {
    console.error("Failed to fetch messages for room", room, error);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  try {
    const auth = socket.handshake.auth as { token?: string } | undefined;
    const queryToken = socket.handshake.query?.token;
    const token =
      (auth && typeof auth.token === "string" && auth.token) ||
      (typeof queryToken === "string" ? queryToken : undefined);

    if (!token) {
      socket.emit("error", { error: "Authentication token is required" });
      socket.disconnect(true);
      return;
    }

    const payload = verifyToken(token);
    // Attach user identity to the socket for later use
    // eslint-disable-next-line no-param-reassign
    socket.data.user = {
      id: payload.sub,
      email: payload.email,
      displayName: payload.displayName,
    };
  } catch (error) {
    console.error("Socket authentication failed", error);
    socket.emit("error", { error: "Authentication failed" });
    socket.disconnect(true);
    return;
  }

  const connectedUser = socket.data
    .user as { id: string; email?: string; displayName?: string } | undefined;
  const connectedLabel =
    connectedUser?.displayName || connectedUser?.email || socket.id;
  console.log(`Client connected: ${connectedLabel}`);

  socket.on("join_room", (room: string) => {
    socket.join(room);

    const userFromSocket = socket.data.user as
      | { id: string; email: string; displayName?: string }
      | undefined;
    const displayName =
      userFromSocket?.displayName ?? userFromSocket?.email ?? "Someone";
    const userId = userFromSocket?.id ?? null;

    socket.to(room).emit("user_joined", {
      socketId: socket.id,
      userId,
      displayName,
    });
  });

  socket.on(
    "chat_message",
    async (payload: {
      room: string;
      message: string;
      replyToMessageId?: number | null;
      attachmentIds?: number[];
    }) => {
      const { room, message, replyToMessageId, attachmentIds } = payload;
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined;
      const displayName =
        userFromSocket?.displayName ?? userFromSocket?.email ?? "Unknown";
      const userId = userFromSocket?.id;
      const timestamp = new Date().toISOString();
      try {
        const saved = await saveMessage({
          room,
          username: displayName,
          message,
          userId,
          replyToMessageId,
        });
        let attachments: {
          id: number;
          url: string;
          mimeType: string | null;
          fileSize: number | null;
          originalFilename: string | null;
        }[] = [];

        if (
          userId &&
          Array.isArray(attachmentIds) &&
          attachmentIds.length > 0
        ) {
          try {
            const assigned = await assignAttachmentsToMessage({
              attachmentIds,
              messageId: saved.id,
              userId,
            });

            attachments = assigned.map((a) => ({
              id: a.id,
              url: a.url,
              mimeType: a.mime_type,
              fileSize: a.file_size,
              originalFilename: a.original_filename,
            }));
          } catch (error) {
            console.error("Failed to assign attachments to message", error);
          }
        }

        io.to(room).emit("chat_message", {
          room,
          message,
          user: displayName,
          userId,
          timestamp: saved.created_at.toISOString(),
          messageId: saved.id,
          replyToMessageId: saved.reply_to_message_id,
          attachments,
        });
      } catch (error) {
        console.error("Failed to persist chat message", error);
      }
    }
  );

  socket.on(
    "edit_message",
    async (payload: { messageId: number; newContent: string }) => {
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined;
      const userId = userFromSocket?.id;
      if (!userId) return;

      const trimmed = payload.newContent.trim();
      if (!trimmed) return;

      try {
        const updated = await editMessageForUser({
          messageId: payload.messageId,
          userId,
          newContent: trimmed,
        });

        if (!updated) return;

        io.to(updated.room).emit("message_edited", {
          messageId: updated.id,
          room: updated.room,
          message: updated.message,
          editedAt: updated.edited_at
            ? updated.edited_at.toISOString()
            : null,
        });
      } catch (error) {
        console.error("Failed to edit message", error);
      }
    }
  );

  socket.on("delete_message", async (payload: { messageId: number }) => {
    const userFromSocket = socket.data.user as
      | { id: string; email: string; displayName?: string }
      | undefined;
    const userId = userFromSocket?.id;
    if (!userId) return;

    try {
      const deleted = await softDeleteMessageForUser({
        messageId: payload.messageId,
        userId,
      });

      if (!deleted) return;

      io.to(deleted.room).emit("message_deleted", {
        messageId: deleted.id,
        room: deleted.room,
        deletedAt: deleted.deleted_at
          ? deleted.deleted_at.toISOString()
          : null,
      });
    } catch (error) {
      console.error("Failed to delete message", error);
    }
  });

  socket.on(
    "mark_read",
    async (payload: { room: string; messageId: number }) => {
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined;
      const userId = userFromSocket?.id;
      if (!userId) return;

      if (!payload.room || !payload.messageId) return;

      try {
        const updated = await upsertReadReceipt({
          room: payload.room,
          userId,
          lastReadMessageId: payload.messageId,
        });

        io.to(payload.room).emit("read_receipt_updated", {
          room: updated.room,
          userId: updated.user_id,
          lastReadMessageId: updated.last_read_message_id,
          updatedAt: updated.updated_at.toISOString(),
        });

        const [unreadRows, mentionUnreadRows] = await Promise.all([
          getUnreadCountsForUser(userId),
          getMentionUnreadCountsForUser(userId),
        ]);

        const unreadByRoom: Record<string, number> = {};
        for (const row of unreadRows) {
          unreadByRoom[row.room] = row.unread_count;
        }

        const mentionUnreadByRoom: Record<string, number> = {};
        for (const row of mentionUnreadRows) {
          mentionUnreadByRoom[row.room] = row.unread_count;
        }

        socket.emit("unread_counts", {
          unreadCounts: unreadByRoom,
          mentionUnreadCounts: mentionUnreadByRoom,
        });
      } catch (error) {
        console.error("Failed to update read receipt", error);
      }
    }
  );

  socket.on(
    "add_reaction",
    async (payload: { messageId: number; emoji: string; room: string }) => {
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined;
      const userId = userFromSocket?.id;
      if (!userId) return;

      const emoji = payload.emoji?.trim();
      if (!emoji) return;

      try {
        await addReactionForUser({
          messageId: payload.messageId,
          userId,
          emoji,
        });

        io.to(payload.room).emit("reaction_updated", {
          messageId: payload.messageId,
          emoji,
          userId,
          type: "added" as const,
        });
      } catch (error) {
        console.error("Failed to add reaction", error);
      }
    }
  );

  socket.on(
    "remove_reaction",
    async (payload: { messageId: number; emoji: string; room: string }) => {
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined;
      const userId = userFromSocket?.id;
      if (!userId) return;

      const emoji = payload.emoji?.trim();
      if (!emoji) return;

      try {
        await removeReactionForUser({
          messageId: payload.messageId,
          userId,
          emoji,
        });

        io.to(payload.room).emit("reaction_updated", {
          messageId: payload.messageId,
          emoji,
          userId,
          type: "removed" as const,
        });
      } catch (error) {
        console.error("Failed to remove reaction", error);
      }
    }
  );

  socket.on("typing", (payload: { room: string; isTyping: boolean }) => {
    const { room, isTyping } = payload;
    const userFromSocket = socket.data.user as
      | { id: string; email: string; displayName?: string }
      | undefined;
    const displayName =
      userFromSocket?.displayName ?? userFromSocket?.email ?? "Unknown";
    const userId = userFromSocket?.id;
    socket
      .to(room)
      .emit("typing", { room, user: displayName, userId, isTyping });
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${connectedLabel}`);
  });
});

server.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
  void initDb()
    .then(() => {
      console.log("Database initialized");
    })
    .catch((error) => {
      console.error("Failed to initialize database", error);
    });
});
