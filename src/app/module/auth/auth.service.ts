/** biome-ignore-all lint/correctness/noUnreachable: <explanation> */
/** biome-ignore-all lint/correctness/noUnusedVariables: <explanation> */
/** biome-ignore-all lint/style/useConst: <explanation> */
import bcrypt from "bcryptjs";
import ejs from "ejs";
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
	IVerifyEmailPayload,
} from "./auth.interface";
import { TokenPayload } from "google-auth-library";
import { googleClient } from "../../lib/googleAuth";
import { randomInt } from "crypto";
import path from "path";
import { redisClient } from "../../lib/lib";
import { transporter } from "../../lib/nodemailer";

const sendWelcomeEmail = async (email: string, name: string) => {
	try {
		const templatePath = path.join(
			process.cwd(),
			"src",
			"app",
			"templates",
			"patient-welcome-email.ejs",
		);

		const templateData = { name };
		const html = await ejs.renderFile(templatePath, templateData);

		await transporter.sendMail({
			from: config.smtp_sender,
			to: email,
			subject: "Welcome to PH Healthcare System",
			text: `Welcome to PH Healthcare System, ${name}! Your account has been created successfully.`,
			html,
		});
	} catch (error) {
		console.error("Failed to send welcome email:", error);
	}
};

const registerPatient = async (payload: IRegisterPatientPayload) => {
	const { name, password, patient: patientData } = payload;
	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new Error("User with this email already exists");
	}

	const hashedPassword = await bcrypt.hash(password, 8);

	const otp = randomInt(100000, 999999).toString();
	const otpKey = `patient_register_otp:${email}`;
	const expiration = 5 * 60; // 5 minutes

	await redisClient.set(otpKey, otp, {
		expiration: {
			type: "EX",
			value: expiration,
		},
	});

	const patientRegistrationKey = `patient_registration_data:${email}`;
	const redisUserDataPayload = {
		name,
		email,
		password: hashedPassword,
		patient: patientData,
	};

	await redisClient.set(
		patientRegistrationKey,
		JSON.stringify(redisUserDataPayload),
		{
			expiration: {
				type: "EX",
				value: expiration,
			},
		},
	);

	const templatePath = path.join(
		process.cwd(),
		"src",
		"app/templates",
		"register-patient.ejs",
	);

	const templateData = {
		otp,
		name,
		email,
		expirationMinutes: expiration / 60, // Convert seconds to minutes
	};
	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.smtp_sender,
		to: email,
		subject: "Verify Your Email",
		text: `Your verification code is: ${otp}. It expires in 5 minutes.`,
		html,
	});
};

const verifyPatientEmail = async (payload: IVerifyEmailPayload) => {
	const { email, otp } = payload;

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (user?.status === UserStatus.BLOCKED) {
		throw new Error("User is blocked");
	}

	if (user?.isDeleted || user?.status === UserStatus.DELETED) {
		throw new Error("User is deleted");
	}

	if (user?.emailVerified) {
		throw new Error("Email is already verified");
	}

	const otpKey = `patient_register_otp:${email}`;
	const redisOtp = await redisClient.get(otpKey);

	if (!redisOtp) {
		throw new Error("OTP expired or not found");
	}

	if (redisOtp !== otp) {
		throw new Error(
			"Invalid OTP! Please check your email and enter the correct OTP.",
		);
	}

	const patientRegistrationKey = `patient_registration_data:${email}`;
	const redisPatientData = await redisClient.get(patientRegistrationKey);

	if (!redisPatientData) {
		throw new Error(
			"Patient registration data not found. Please register again.",
		);
	}

	const patientPayload: IRegisterPatientPayload = JSON.parse(redisPatientData);

	const createdUser = await prisma.user.create({
		data: {
			name: patientPayload.name,
			email: patientPayload.email,
			password: patientPayload.password,
			role: Role.PATIENT,
			status: UserStatus.ACTIVE,
			emailVerified: true,
			patient: {
				create: {
					name: patientPayload.name,
					email: patientPayload.email,
					contactNumber: patientPayload.patient?.contactNumber,
				},
			},
		},
		omit: { password: true },
		include: { patient: true },
	});

	const { patient, ...userData } = createdUser;

	const jwtPayload = {
		userId: userData.id,
		name: userData.name,
		email: userData.email,
		role: userData.role,
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

	await redisClient.del([otpKey, patientRegistrationKey]);

	await sendWelcomeEmail(email, createdUser.name);

	return { user: userData, patient, accessToken, refreshToken };
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

				await sendWelcomeEmail(user.email, user.name);
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
	if (!user.googleId && user.authProvider === AuthProvider.GOOGLE) {
		throw new Error("User registered with Google. Please use Google login.");
	}
	if (!user.emailVerified) {
		throw new Error("Please verify your email first.");
	}

	// otp generate by crypto and send email to user with reset password link containing token and otp
	const otp = randomInt(100000, 999999).toString();
	const key = `forgot_password_otp:${user.email}`;

	await redisClient.set(key, otp, {
		expiration: {
			type: "EX",
			value: 5 * 60, // 5 minutes
		},
	});

	const templatePath = path.join(
		process.cwd(),
		"src",
		"app",
		"templates",
		"forgot-password.ejs",
	);

	const html = await ejs.renderFile(templatePath, { otp });

	await transporter.sendMail({
		from: config.smtp_sender,
		to: user.email,
		subject: "Password Reset Verification Code",
		text: `Your password reset code is: ${otp}. It expires in 5 minutes. If you did not request this, please ignore this email.`,
		html,
	});
};

const resetPassword = async (payload: IResetPasswordPayload) => {
	const { email, otp, newPassword } = payload;

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
	if (!user.googleId && user.authProvider === AuthProvider.GOOGLE) {
		throw new Error("User registered with Google. Please use Google login.");
	}
	if (!user.emailVerified) {
		throw new Error("Please verify your email first.");
	}

	const key = `forgot_password_otp:${user.email}`;
	const redisOtp = await redisClient.get(key);

	if (!redisOtp) {
		throw new Error("OTP expired or not found");
	}

	if (redisOtp !== otp) {
		throw new Error("Invalid OTP");
	}

	const hashedPassword = await bcrypt.hash(
		newPassword,
		Number(config.bcrypt_salt_rounds),
	);
	await prisma.user.update({
		where: { email },
		data: {
			password: hashedPassword,
		},
	});
	await redisClient.del([key]);
};

export const AuthService = {
	registerPatient,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword,
	resetPassword,
	verifyPatientEmail,
};
