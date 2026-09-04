import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useForm } from "../../hooks/useForm/useForm";
import z from "zod";

interface FormProps<G> {
  children: ReactNode;
  defaultFormObject: G;
  submitAction: (form: G) => Promise<void>;
  validationRules?: z.ZodType;
}

interface FormContextInterface<G> {
  form: G;
  setForm: (f: G) => void;
  submit: () => void;
  formActive: boolean;
  errors: Map<string, string[]>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic form shape is erased at the context boundary, narrowed by each consumer
const FormContext = createContext<FormContextInterface<any> | undefined>(
  undefined,
);

export function Form<G extends object>(props: FormProps<G>) {
  const { children, defaultFormObject, submitAction, validationRules } = props;

  const { form, setForm, submit, formActive, activateForm, errors } = useForm({
    initialValue: defaultFormObject,
    submitAction: submitAction,
    validationRules: validationRules,
  });

  useEffect(() => {
    activateForm();
  });

  return (
    <FormContext.Provider value={{ form, setForm, submit, formActive, errors }}>
      {children}
    </FormContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook colocated with its provider
export function useFormContext() {
  return useContext(FormContext);
}
