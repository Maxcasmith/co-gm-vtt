import { Input } from "../../components/Input/Input";
import { Form } from "../../components/Form/Form";
import { Submit } from "../../components/Button/Submit/Submit";
import { Button } from "../../components/Button/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../components/Card";
import "./Signup.css";
import { useNavigate } from "react-router-dom";

const defaultForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
};

type Form = keyof typeof defaultForm;

export function Signup() {
  const navigate = useNavigate();

  const submit = async (f: typeof defaultForm) => {
    console.log(f);
  };

  const handleNavigateToLogin = () => navigate("/login");

  return (
    <>
      <Form defaultFormObject={defaultForm} submitAction={submit}>
        <Card>
          <CardHeader>
            <h1 className="signup--page--create--user--card--title">
              Create Your Account
            </h1>
          </CardHeader>
          <CardBody>
            <div className="signup--page--create--user--wrapper">
              <Input<Form> name="firstName" label="First Name" />
              <Input<Form> name="lastName" label="Last Name" />
              <Input<Form> name="email" label="Email" />
              <Input<Form> name="password" label="Password" type="password" />
              <Input<Form>
                name="confirmPassword"
                label="Confirm Password"
                type="password"
              />
            </div>
          </CardBody>
          <CardFooter>
            <Submit>Sign up</Submit>
            <Button onClick={handleNavigateToLogin}>Login</Button>
          </CardFooter>
        </Card>
      </Form>
    </>
  );
}
