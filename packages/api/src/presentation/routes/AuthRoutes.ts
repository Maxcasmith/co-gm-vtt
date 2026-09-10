import { Router, type Router as RouterType } from "express";
import { AuthController } from "@controllers/AuthController/AuthController";
import { Container } from "@/presentation/containers";
import { jwtMiddleware } from "@/presentation/middleware/AuthMiddleware/AuthMiddleware";

const router: RouterType = Router();
const authController = new AuthController(Container.auth);

// PUBLIC routes (no authentication required)
router.post("/auth/google/signin", (req, res) =>
  authController.googleSignin(req, res),
);

router.post("/auth/signup", (req, res) =>
  authController.signup(req, res),
);

router.post("/auth/login", (req, res) =>
  authController.login(req, res),
);

router.post("/auth/refresh", (req, res) =>
  authController.refreshToken(req, res),
);

// PROTECTED routes (require valid access token)
router.get("/auth/me", jwtMiddleware, (req, res) =>
  authController.getCurrentUser(req, res),
);

router.get("/auth/sessions", jwtMiddleware, (req, res) =>
  authController.getSessions(req, res),
);

router.post("/auth/sessions/:sessionId/revoke", jwtMiddleware, (req, res) =>
  authController.revokeSession(req, res),
);

router.post("/auth/change-password", jwtMiddleware, (req, res) =>
  authController.changePassword(req, res),
);

export default router;
