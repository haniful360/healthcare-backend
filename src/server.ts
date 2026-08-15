import app from "./app";
import config from "./app/config";
import { redisClient } from "./app/lib/lib";
import { prisma } from "./app/lib/prisma";

const PORT = config.port;

const main = async () => {
	try {
		await prisma.$connect();
		await redisClient.connect();
		console.log("Connected to Redis successfully.");
		console.log("Connected to the database successfully.");
		app.listen(PORT, () => {
			console.log(`Server is running on port ${PORT}`);
		});
	} catch (error) {
		console.error("Error starting the server:", error);
		await prisma.$disconnect();
		process.exit(1);
	}
};

main();
