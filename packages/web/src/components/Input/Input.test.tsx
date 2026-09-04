import userEvent from "@testing-library/user-event";
import { Input } from "./Input";

import { screen, render } from "@testing-library/react";

describe('Input', () => {
  it('Should be usable when not disabled', async () => {
    const user = userEvent.setup();
    render(<Input />)

    const textbox = screen.getByRole("textbox")
    await user.type(textbox, 'test');
    expect(textbox).toHaveValue('test');
  });

  it('Should not be usable when disabled', async () => {
    const user = userEvent.setup();
    render(<Input value="FooBar" disabled={true} />)

    const textbox = screen.getByRole("textbox")

    expect(textbox).toBeDisabled();

    await user.type(textbox, 'test');
    expect(textbox).toHaveValue('FooBar');
  });
});
