import { Router } from "express";
import { UserController } from "./user.controller";
import { upload } from "../../lib/multer";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";

const router = Router();


router.patch("/profile-image", auth(Role.PATIENT, Role.SUPER_ADMIN, Role.ADMIN, Role.DOCTOR), upload.single("profileImage"), UserController.uploadProfileImage);
export const UserRoutes = router;
