import { Router, type Router as RouterType } from "express";
import { Container } from "@/presentation/containers";
import {
  jwtMiddleware,
  type AuthenticatedRequest,
} from "@/presentation/middleware/AuthMiddleware/AuthMiddleware";

const router: RouterType = Router();

router.get("/users/me", jwtMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "User not authenticated" });
    return;
  }

  const user = await Container.auth.userRepository.findById(req.user.sub);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const products = await Container.auth.userProductRepository.findCodesByUserId(req.user.sub);

  res.json({ ...user.present(), products });
});

export default router;
