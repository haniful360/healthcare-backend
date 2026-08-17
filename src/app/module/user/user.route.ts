import { Router } from "express";
import { UserController } from "./user.controller";
import { upload } from "../../lib/multer";
import { cloudinaryUtils } from "../../lib/cloudinary";

const router = Router();


router.patch("/profile-image", upload.single("profileImage"), UserController.uploadProfileImage);
export const UserRoutes = router;
