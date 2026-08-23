-- CreateEnum
CREATE TYPE "ApointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'ONGOING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'CANCELLED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "apointments" (
    "id" TEXT NOT NULL,
    "status" "ApointmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "paymentGateway" TEXT NOT NULL DEFAULT 'bkash',
    "merchantInvoiceNumber" TEXT NOT NULL,
    "bkashPaymentId" TEXT,
    "bkashTrxId" TEXT,
    "payerRefference" TEXT,
    "paidAt" TEXT,
    "gatewayResponse" JSONB,
    "refunndtrxId" TEXT,
    "refundAmount" DECIMAL(10,2) NOT NULL,
    "refuncReason" TEXT,
    "refundAt" TEXT,
    "apointmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_merchantInvoiceNumber_key" ON "payments"("merchantInvoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_bkashPaymentId_key" ON "payments"("bkashPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_apointmentId_key" ON "payments"("apointmentId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_apointmentId_fkey" FOREIGN KEY ("apointmentId") REFERENCES "apointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
