/**
 * Login page (P0 Baseline §13.1, §13.2).
 *
 * The identifier is the account email; a failed login produces one generic message that
 * never reveals which half was wrong, and an inactive account refuses identically.
 *
 * Form state is React Hook Form with a Zod schema, because §13.2 freezes that pairing for
 * every form in the app — the scaffold establishes it here so later pages follow a working
 * example rather than inventing their own. Login *behaviour* (which accounts exist, what a
 * session means) is issue #47's; this file's job is to show the pairing wired.
 *
 * §13.1 also puts 演示账户说明 and 紧急渠道提示 on this page. Neither is rendered here, because
 * the account list is #45's seed data and the copy is #47's — printing accounts that do not
 * exist sends users to a login page that cannot work.
 *
 * Layout: two panels. The narrative panel answers "what is this system for" before the
 * form asks for anything, and the form panel stays narrow so the fields keep a measure.
 */

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate, useNavigate } from "react-router-dom";

import { landingFor, useAuth } from "./AuthContext";
import { Icon } from "../../components/Icon";
import { TextField } from "../../components/Field";
import { ApiError } from "../../api/client";
import { classify } from "../../lib/errors";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login, user, initialising } = useAuth();
  const navigate = useNavigate();

  const [banner, setBanner] = useState<string | null>(null);
  /** Field messages from the server, kept apart from Zod's client-side ones. */
  const [serverFields, setServerFields] = useState<Record<string, string>>({});

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    if (!initialising && user) navigate(landingFor(user.role), { replace: true });
  }, [initialising, user, navigate]);

  if (!initialising && user) return <Navigate to={landingFor(user.role)} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    setServerFields({});
    try {
      const resolved = await login(values.email, values.password);
      navigate(landingFor(resolved.role), { replace: true });
    } catch (error) {
      const classified = classify(error);
      // A 401 with no field errors is the generic refusal; VALIDATION_ERROR is the
      // server saying a specific field is wrong, which belongs beside that field.
      if (classified.kind === "validation" && Object.keys(classified.fields).length > 0) {
        setServerFields(classified.fields);
      } else if (error instanceof ApiError && error.isUnauthorized) {
        setBanner("Email or password is not correct.");
      } else {
        setBanner(classified.message);
      }
    }
  });

  /** Server messages win, because a rejected value means the client schema was not enough. */
  const fieldError = (name: "email" | "password") =>
    serverFields[name] ?? errors[name]?.message;

  return (
    <div className="login-page">
      <div className="login-panel">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="wrench" />
        </span>
        <h1>CampusFix</h1>
        <p className="login-lede">
          Campus facility repairs — submit a fault, follow its progress, and always see who acts
          next.
        </p>
        <ul className="login-points">
          <li>
            <Icon name="check" className="icon-sm" />
            Reporters track every step of their ticket
          </li>
          <li>
            <Icon name="check" className="icon-sm" />
            Dispatchers review, prioritise and assign
          </li>
          <li>
            <Icon name="check" className="icon-sm" />
            Technicians submit the result from the site
          </li>
        </ul>
      </div>

      <div className="login-side">
        <main className="login-card">
          <header className="login-head">
            <h2>Log in</h2>
            <p className="login-sub">Use the email address of your account.</p>
          </header>

          {banner ? (
            <div className="banner banner-error" role="alert">
              <div className="banner-body">
                <span>{banner}</span>
              </div>
            </div>
          ) : null}
          <form onSubmit={onSubmit} noValidate>
            <TextField
              id="login-email"
              label="Email"
              required
              type="email"
              autoComplete="username"
              error={fieldError("email")}
              {...register("email")}
            />
            <TextField
              id="login-password"
              label="Password"
              required
              type="password"
              autoComplete="current-password"
              error={fieldError("password")}
              {...register("password")}
            />
            <button type="submit" className="primary login-submit" disabled={isSubmitting}>
              {isSubmitting ? "Logging in…" : "Log in"}
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
