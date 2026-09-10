import bcrypt from "bcrypt";
import type { CommandHandler } from "@commands/CommandHandler";
import type { ChangePasswordCommand } from "./ChangePasswordCommand";
import type { IUserRepository } from "@repositories/UserRepository/UserRepository";

const PASSWORD_HASH_ROUNDS = 10;

export class ChangePasswordCommandHandler implements CommandHandler<ChangePasswordCommand, void> {
  constructor(private readonly userRepository: IUserRepository) { }

  async handle(command: ChangePasswordCommand): Promise<void> {
    const user = await this.userRepository.findById(command.userId);

    if (!user || !user.password) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const currentMatches = await bcrypt.compare(command.currentPassword, user.password);
    if (!currentMatches) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const hashedPassword = await bcrypt.hash(command.newPassword, PASSWORD_HASH_ROUNDS);

    await this.userRepository.update({
      id: command.userId,
      data: { password: hashedPassword },
    });
  }
}
