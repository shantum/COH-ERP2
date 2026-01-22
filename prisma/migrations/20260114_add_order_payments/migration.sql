-- CreateTable: OrderPayment for tracking individual payment transactions
CREATE TABLE "OrderPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderPayment_orderId_idx" ON "OrderPayment"("orderId");
CREATE INDEX "OrderPayment_recordedAt_idx" ON "OrderPayment"("recordedAt");
CREATE INDEX "OrderPayment_orderId_recordedAt_idx" ON "OrderPayment"("orderId", "recordedAt");

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON UPDATE CASCADE;
