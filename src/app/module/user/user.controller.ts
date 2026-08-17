import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";




const uploadProfileImage = catchAsync(async (req: Request, res: Response) => {
    const file = req.file;
    console.log(file, "file");
    
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Profile image uploaded successfully",
        data: null,
    });
});



export const UserController = {
    uploadProfileImage,
    
};
