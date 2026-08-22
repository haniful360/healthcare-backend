import { Router } from "express";
import { AppointmentController } from "./apointment.controller";


const router = Router();

router.post("/book-appointment", AppointmentController.bookAppointment);

//book appointment callback url
router.get(
  "/book-appointment/payment/callback",
  AppointmentController.bookAppointmentCallback,
);

export const AppointementRoutes = router;
