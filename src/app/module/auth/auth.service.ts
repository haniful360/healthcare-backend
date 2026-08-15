/** biome-ignore-all lint/correctness/noUnreachable: <explanation> */
/** biome-ignore-all lint/correctness/noUnusedVariables: <explanation> */
/** biome-ignore-all lint/style/useConst: <explanation> */
import bcrypt from "bcryptjs";
import { JwtPayload, SignOptions } from "jsonwebtoken";
import {
  AuthProvider,
  Role,
  UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { jwtUtils } from "../../utils/jwt";
import {
  IForgotPasswordPayload,
  IGoogleLoginPayload,
  ILoginUserPayload,
  IRegisterPatientPayload,
  IRequestUser,
  IResetPasswordPayload,
} from "./auth.interface";
import { TokenPayload } from "google-auth-library";
import { googleClient } from "../../lib/googleAuth";
import { randomInt } from "crypto";
import { redisClient } from "../../lib/lib";

const registerPatient = async (payload: IRegisterPatientPayload) => {
  const { name, password } = payload;
  const email = payload.email.trim().toLowerCase();

  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (isUserExists) {
    throw new Error("User with this email already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 8);

  const createdUser = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: Role.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: false,
      patient: {
        create: { name, email },
      },
    },
    omit: { password: true },
    include: { patient: true },
  });

  const { patient, ...user } = createdUser;
  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    user,
    patient,
    accessToken,
    refreshToken,
  };
};

const loginUser = async (payload: ILoginUserPayload) => {
  const { password } = payload;
  const email = payload.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (user.status === UserStatus.BLOCKED) {
    throw new Error("User is blocked");
  }

  if (user.isDeleted || user.status === UserStatus.DELETED) {
    throw new Error("User is deleted");
  }

  const isPasswordMatched = await bcrypt.compare(password, user.password);

  if (!isPasswordMatched) {
    throw new Error("Invalid credentials");
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const getMe = async (user: IRequestUser) => {
  const isUserExists = await prisma.user.findUnique({
    where: {
      id: user.userId,
    },
    include: {
      patient: true,
    },
    omit: {
      password: true,
    },
  });

  if (!isUserExists) {
    throw new Error("User not found");
  }

  return isUserExists;
};

const refreshToken = async (token: string) => {
  const verifiedRefreshToken = jwtUtils.verifyToken(
    token,
    config.jwt_refresh_secret,
  );

  if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
    throw new Error(
      config.node_env === "development"
        ? verifiedRefreshToken.error
        : "Invalid refresh token",
    );
  }

  const data = verifiedRefreshToken.data as JwtPayload;

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
  });

  if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
    throw new Error("User is inactive or not found");
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const googleLogin = async (payload: IGoogleLoginPayload) => {
  let googleIdTokenPayload: TokenPayload | null | undefined = null;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: payload.token,
      audience: config.google_client_id,
    });

    googleIdTokenPayload = ticket.getPayload();

    if (!googleIdTokenPayload) {
      throw new Error("Google ID token payload is missing");
    }

    if (
      !googleIdTokenPayload.email ||
      !googleIdTokenPayload.name ||
      !googleIdTokenPayload.sub
    ) {
      throw new Error("Google ID token payload is missing required fields");
    }

    const ifPatientExistsWithGoogleAuth = await prisma.user.findUnique({
      where: {
        email: googleIdTokenPayload.email,
        role: Role.PATIENT,
        googleId: googleIdTokenPayload.sub,
      },
    });

    let user = ifPatientExistsWithGoogleAuth;

    if (!ifPatientExistsWithGoogleAuth) {
      const ifPatientExistsWithCredentials = await prisma.user.findUnique({
        where: {
          email: googleIdTokenPayload.email,
          role: Role.PATIENT,
          authProvider: AuthProvider.CREDENTIALS,
        },
      });

      if (ifPatientExistsWithCredentials) {
        if (ifPatientExistsWithCredentials.status === UserStatus.BLOCKED) {
          throw new Error("User is blocked");
        }

        if (
          ifPatientExistsWithCredentials.isDeleted ||
          ifPatientExistsWithCredentials.status === UserStatus.DELETED
        ) {
          throw new Error("User is deleted");
        }

        user = await prisma.user.update({
          where: {
            id: ifPatientExistsWithCredentials.id,
          },
          data: {
            googleId: googleIdTokenPayload.sub,
            // authProvider: AuthProvider.GOOGLE,
          },
        });
      } else {
		// google register
        user = await prisma.user.create({
          data: {
            name: googleIdTokenPayload.name,
            email: googleIdTokenPayload.email,
            googleId: googleIdTokenPayload.sub,
            authProvider: AuthProvider.GOOGLE,
            password: "",
            role: Role.PATIENT,
            status: UserStatus.ACTIVE,
            emailVerified: true,
            patient: {
              create: {
                name: googleIdTokenPayload.name,
                email: googleIdTokenPayload.email,
              },
            },
          },
          include: {
            patient: true,
          },
        });
      }
    }

    if (!user) {
      throw new Error("User Not Found");
    }

    if (user.status === UserStatus.BLOCKED) {
      throw new Error("User Is Blocked");
    }

    if (user.isDeleted || user.status === UserStatus.DELETED) {
      throw new Error("User Is Deleted");
    }

    const jwtPayload = {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    const accessToken = jwtUtils.createToken(
      jwtPayload,
      config.jwt_access_secret,
      config.jwt_access_expires_in as SignOptions,
    );

    const refreshToken = jwtUtils.createToken(
      jwtPayload,
      config.jwt_refresh_secret,
      config.jwt_refresh_expires_in as SignOptions,
    );

    return {
      user,
      accessToken,
      refreshToken,
    };
  } catch (error) {
    throw new Error("Google ID token verification failed");
  }
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {

	const user = await prisma.user.findUnique({
		where: { email: payload.email },
	});
  if (!user) {
    throw new Error("User not found");
  }

  if (user.status === UserStatus.BLOCKED) {
    throw new Error("User is blocked");
  }

  if (user.isDeleted || user.status === UserStatus.DELETED) {
    throw new Error("User is deleted");
  }
  if(!user.googleId && user.authProvider === AuthProvider.GOOGLE) {
    throw new Error("User registered with Google. Please use Google login.");
  }

  // otp generate by crypto and send email to user with reset password link containing token and otp
  const otp = randomInt(100000, 999999).toString();
  const key = `forgot_password_otp:${user.email}`;

  await redisClient.set(key, otp, {
    expiration: {
      type: "EX",
      value: 5 * 60, // 5 minutes
    }
  });

  const jwtPayload = {
    userId: user.id,
    email: user.email,
  };

 

};

const resetPassword = async (payload: IResetPasswordPayload) => {
  const verifiedToken = jwtUtils.verifyToken(
    payload.token,
    config.jwt_reset_password_secret,
  );


}

export const AuthService = {
  registerPatient,
  loginUser,
  getMe,
  refreshToken,
  googleLogin,
  forgotPassword,
  resetPassword,
};
