export function passwordsMismatch(password: string, confirmPassword: string): boolean {
  return (password !== '' || confirmPassword !== '') && password !== confirmPassword;
}
