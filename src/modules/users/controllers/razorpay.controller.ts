//  import { FastifyRequest, FastifyReply } from "fastify";
// import { db } from "../../../models/db.js";
// import Razorpay from "razorpay";
// import crypto from "crypto";

// // Initialize Razorpay only if credentials are available
// let razorpay: Razorpay | null = null;

// const getRazorpayInstance = () => {
//   if (!razorpay) {
//     const keyId = process.env.RAZORPAY_KEY_ID;
//     const keySecret = process.env.RAZORPAY_KEY_SECRET;

//     if (
//       !keyId ||
//       !keySecret ||
//       keyId.includes("placeholder") ||
//       keySecret.includes("placeholder")
//     ) {
//       throw new Error(
//         "Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables."
//       );
//     }

//     razorpay = new Razorpay({
//       key_id: keyId,
//       key_secret: keySecret,
//     });
//   }
//   return razorpay;
// };

// // Get available credit packages
// export const getCreditPackages = async (
//   req: FastifyRequest,
//   reply: FastifyReply
// ) => {
//   try {
//     const packages = await db
//       .selectFrom("credit_packages")
//       .selectAll()
//       .where("is_active", "=", 1)
//       .orderBy("price", "asc")
//       .execute();

//     return reply.status(200).send({
//       status: 1,
//       data: packages,
//     });
//   } catch (err) {
//     req.log.error({ err }, "Error fetching credit packages");
//     return reply.status(500).send({
//       status: 0,
//       message: "Failed to fetch credit packages",
//     });
//   }
// };

// // Create Razorpay order for credit purchase
// export const createPaymentOrder = async (
//   req: FastifyRequest,
//   reply: FastifyReply
// ) => {
//   const username = (req as any).user?.username;
//   const { packageId, amount, credits } = req.body as {
//     packageId: number;
//     amount: number;
//     credits: number;
//   };

//   if (!username) {
//     return reply.status(401).send({
//       status: 0,
//       message: "Unauthorized: Username missing from token",
//     });
//   }

//   try {
//     // Verify package exists and is active
//     const packageData = await db
//       .selectFrom("credit_packages")
//       .selectAll()
//       .where("id", "=", packageId)
//       .where("is_active", "=", 1)
//       .executeTakeFirst();

//     if (!packageData) {
//       return reply.status(400).send({
//         status: 0,
//         message: "Invalid credit package",
//       });
//     }

//     // Create Razorpay order
//     const orderOptions = {
//       amount: amount * 100, // Razorpay expects amount in paise
//       currency: "INR",
//       receipt: `credit_purchase_${Date.now()}`,
//       notes: {
//         username,
//         packageId: packageId.toString(),
//         credits: credits.toString(),
//       },
//     };

//     const razorpayInstance = getRazorpayInstance();
//     const order = await razorpayInstance.orders.create(orderOptions);

//     // Save order to database
//     await db
//       .insertInto("payment_orders")
//       .values({
//         username,
//         user_id: (req as any).user?.id || 0,
//         razorpay_order_id: order.id,
//         amount,
//         currency: "INR",
//         status: "created",
//         credits_purchased: credits,
//         description: `Purchase of ${credits} credits`,
//       })
//       .execute();

//     return reply.status(200).send({
//       status: 1,
//       data: {
//         orderId: order.id,
//         amount: order.amount,
//         currency: order.currency,
//         key: process.env.RAZORPAY_KEY_ID || "not_configured",
//       },
//     });
//   } catch (err) {
//     req.log.error({ err }, "Error creating payment order");
//     return reply.status(500).send({
//       status: 0,
//       message: "Failed to create payment order",
//     });
//   }
// };

// // Verify payment and add credits
// export const verifyPayment = async (
//   req: FastifyRequest,
//   reply: FastifyReply
// ) => {
//   const username = (req as any).user?.username;
//   // Support both Razorpay verify payload and Indew gateway payload
//   const {
//     razorpay_order_id,
//     razorpay_payment_id,
//     razorpay_signature,
//     orderId,
//     paymentId,
//     signature,
//     sessionId,
//     status,
//   } = (req.body || {}) as Record<string, string>;

//   if (!username) {
//     return reply.status(401).send({
//       status: 0,
//       message: "Unauthorized: Username missing from token",
//     });
//   }

//   try {
//     // Normalize fields
//     const normalizedOrderId = razorpay_order_id || orderId || "";
//     const normalizedPaymentId =
//       razorpay_payment_id || paymentId || sessionId || "";
//     const normalizedSignature = razorpay_signature || signature || "";

//     if (!normalizedOrderId) {
//       return reply.status(400).send({ status: 0, message: "Missing order id" });
//     }

//     // Get order from database
//     const order = await db
//       .selectFrom("payment_orders")
//       .selectAll()
//       .where("razorpay_order_id", "=", normalizedOrderId)
//       .where("username", "=", username)
//       .executeTakeFirst();

//     if (!order) {
//       return reply.status(400).send({
//         status: 0,
//         message: "Order not found",
//       });
//     }

//     if (order.status === "paid") {
//       return reply.status(200).send({
//         status: 1,
//         message: "Payment already processed",
//         data: {
//           creditsAdded: order.credits_purchased,
//         },
//       });
//     }

//     // Two verification paths:
//     // 1) Razorpay form fields with signature
//     // 2) Gateway callback fields (orderId/sessionId/status) without signature
//     let verified = false;
//     if (razorpay_order_id && razorpay_payment_id && razorpay_signature) {
//       const body = razorpay_order_id + "|" + razorpay_payment_id;
//       const keySecret = process.env.RAZORPAY_KEY_SECRET;
//       if (!keySecret || keySecret.includes("placeholder")) {
//         return reply.status(500).send({
//           status: 0,
//           message:
//             "Payment verification not available - Razorpay not configured",
//         });
//       }
//       const expectedSignature = crypto
//         .createHmac("sha256", keySecret)
//         .update(body)
//         .digest("hex");
//       if (expectedSignature !== razorpay_signature) {
//         return reply.status(400).send({
//           status: 0,
//           message: "Invalid payment signature",
//         });
//       }
//       verified = true;
//     } else if (
//       normalizedOrderId &&
//       (status === "paid" || status === "success")
//     ) {
//       // Trust gateway success to proceed; webhook signature validation happens separately
//       verified = true;
//     } else {
//       return reply
//         .status(400)
//         .send({ status: 0, message: "Missing parameters" });
//     }

//     // Update order status
//     await db
//       .updateTable("payment_orders")
//       .set({ status: "paid", updated_at: new Date() })
//       .where("id", "=", order.id)
//       .execute();

//     // Add credits to user account
//     const existingCredits = await db
//       .selectFrom("credits")
//       .selectAll()
//       .where("username", "=", username)
//       .executeTakeFirst();

//     if (existingCredits) {
//       await db
//         .updateTable("credits")
//         .set({
//           balance: existingCredits.balance + order.credits_purchased,
//           updated_at: new Date(),
//         })
//         .where("username", "=", username)
//         .execute();
//     } else {
//       await db
//         .insertInto("credits")
//         .values({
//           username,
//           balance: order.credits_purchased,
//           email_credits: 0,
//           created_at: new Date(),
//           updated_at: new Date(),
//         })
//         .execute();
//     }

//     // Record transaction
//     await db
//       .insertInto("payment_transactions")
//       .values({
//         username,
//         user_id: (req as any).user?.id || 0,
//         razorpay_payment_id: normalizedPaymentId || "",
//         razorpay_order_id: normalizedOrderId,
//         amount: order.amount,
//         currency: order.currency,
//         status: "success",
//         credits_added: order.credits_purchased,
//         payment_method: "razorpay",
//       })
//       .execute();

//     // Record credit usage for audit
//     await db
//       .insertInto("credit_usage")
//       .values({
//         id: 0, // Auto-generated
//         username,
//         user_id: (req as any).user?.id || 0,
//         usage_type: "credit_purchase",
//         amount: -order.credits_purchased, // Negative amount for credit addition
//         balance_after:
//           (existingCredits?.balance || 0) + order.credits_purchased,
//         description: `Purchased ${order.credits_purchased} credits via Razorpay`,
//         request_id: normalizedPaymentId || "",
//         metadata: {
//           payment_id: normalizedPaymentId || "",
//           order_id: normalizedOrderId,
//         },
//         created_at: new Date(),
//       })
//       .execute();

//     return reply.status(200).send({
//       status: 1,
//       message: "Payment verified and credits added successfully",
//       data: {
//         creditsAdded: order.credits_purchased,
//         newBalance: (existingCredits?.balance || 0) + order.credits_purchased,
//       },
//     });
//   } catch (err) {
//     req.log.error({ err }, "Error verifying payment");
//     return reply.status(500).send({
//       status: 0,
//       message: "Failed to verify payment",
//     });
//   }
// };

// // Get payment history
// export const getPaymentHistory = async (
//   req: FastifyRequest,
//   reply: FastifyReply
// ) => {
//   const username = (req as any).user?.username;

//   if (!username) {
//     return reply.status(401).send({
//       status: 0,
//       message: "Unauthorized: Username missing from token",
//     });
//   }

//   try {
//     const { page = "1", limit = "10" } =
//       (req.query as Record<string, string>) || {};
//     const pageNum = Math.max(1, Number(page));
//     const perPage = Math.min(100, Math.max(1, Number(limit)));
//     const offset = (pageNum - 1) * perPage;

//     const totalRow = await db
//       .selectFrom("payment_transactions")
//       .select(db.fn.count("id").as("count"))
//       .where("username", "=", username)
//       .executeTakeFirst();

//     const total = Number(totalRow?.count) || 0;

//     const transactions = await db
//       .selectFrom("payment_transactions")
//       .selectAll()
//       .where("username", "=", username)
//       .orderBy("created_at", "desc")
//       .limit(perPage)
//       .offset(offset)
//       .execute();

//     return reply.status(200).send({
//       status: 1,
//       data: {
//         total,
//         currentPage: pageNum,
//         totalPages: Math.ceil(total / perPage),
//         perPage,
//         transactions,
//       },
//     });
//   } catch (err) {
//     req.log.error({ err }, "Error fetching payment history");
//     return reply.status(500).send({
//       status: 0,
//       message: "Failed to fetch payment history",
//     });
//   }
// };

// // Razorpay webhook handler
// export const razorpayWebhook = async (
//   req: FastifyRequest,
//   reply: FastifyReply
// ) => {
//   const signature = req.headers["x-razorpay-signature"] as string;
//   const body = JSON.stringify(req.body);

//   if (!signature) {
//     return reply.status(400).send({ error: "Missing signature" });
//   }

//   try {
//     const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

//     if (!webhookSecret) {
//       return reply.status(500).send({ error: "Webhook secret not configured" });
//     }

//     const expectedSignature = crypto
//       .createHmac("sha256", webhookSecret)
//       .update(body)
//       .digest("hex");

//     if (signature !== expectedSignature) {
//       return reply.status(400).send({ error: "Invalid signature" });
//     }

//     const event = req.body as any;

//     // Handle payment.captured event
//     if (event.event === "payment.captured") {
//       const payment = event.payload.payment.entity;
//       const orderId = payment.order_id;

//       // Update order status if not already updated
//       await db
//         .updateTable("payment_orders")
//         .set({ status: "paid", updated_at: new Date() })
//         .where("razorpay_order_id", "=", orderId)
//         .where("status", "=", "created")
//         .execute();
//     }

//     return reply.status(200).send({ status: "ok" });
//   } catch (err) {
//     req.log.error({ err }, "Webhook processing error");
//     return reply.status(500).send({ error: "Webhook processing failed" });
//   }
// };