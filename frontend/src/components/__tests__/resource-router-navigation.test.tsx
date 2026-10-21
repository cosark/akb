import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, useLocation, useNavigate, type NavigateOptions } from "react-router-dom";
import { ResourceNavigationProvider, useResourceNavigationGuard } from "@/contexts/resource-navigation-context";

afterEach(cleanup);

function Editor({ name, calls, close }: { name: string; calls: (href: string) => void; close?: () => void }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ href: string; options?: NavigateOptions } | null>(null);
  const continueNavigation = useResourceNavigationGuard((href, options) => { calls(href); setPending({ href, options }); return false; });
  return pending && <button onClick={() => { setPending(null); continueNavigation(() => navigate(pending.href, pending.options)); close?.(); }}>Confirm {name}</button>;
}
function Links() {
  const navigate = useNavigate();
  const location = useLocation();
  return <><Link to="/search?q=kept#anchor">Sidebar search</Link><Link to="/search" target="_blank">New tab</Link><button onClick={() => navigate("/vault?q=kept#anchor", { replace: true, state: { retained: 42 } })}>Programmatic replace</button><output aria-label="Route">{location.pathname}{location.search}{location.hash}</output><output aria-label="State">{JSON.stringify(location.state)}</output></>;
}

describe("global internal navigation boundaries", () => {
  it("guards unparticipating sidebar Links and resumes the confirmed push once", async () => {
    const calls = vi.fn();
    render(<MemoryRouter initialEntries={["/doc"]}><ResourceNavigationProvider><Editor name="document" calls={calls} /><Links /></ResourceNavigationProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole("link", { name: "Sidebar search" }));
    expect(screen.getByLabelText("Route")).toHaveTextContent("/doc");
    await userEvent.click(screen.getByRole("button", { name: "Confirm document" }));
    expect(screen.getByLabelText("Route")).toHaveTextContent("/search?q=kept#anchor");
    expect(calls).toHaveBeenCalledOnce();
  });
  it("preserves replace, search, hash and state after a programmatic confirmation", async () => {
    const calls = vi.fn();
    render(<MemoryRouter initialEntries={["/doc"]}><ResourceNavigationProvider><Editor name="guide" calls={calls} /><Links /></ResourceNavigationProvider></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Programmatic replace" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm guide" }));
    expect(screen.getByLabelText("Route")).toHaveTextContent("/vault?q=kept#anchor");
    expect(screen.getByLabelText("State")).toHaveTextContent('{"retained":42}');
    expect(calls).toHaveBeenCalledOnce();
  });
  it("does not intercept modified or new-tab Links", () => {
    const calls = vi.fn();
    render(<MemoryRouter><ResourceNavigationProvider><Editor name="document" calls={calls} /><Links /></ResourceNavigationProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Sidebar search" }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("link", { name: "New tab" }));
    expect(calls).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Route")).toHaveTextContent("/");
  });
  it("shares a single controller across nested previews and retains the lower guard", async () => {
    const documentCalls = vi.fn();
    const previewCalls = vi.fn();
    function Workspace() {
      const [preview, setPreview] = useState(true);
      return <ResourceNavigationProvider><Editor name="document" calls={documentCalls} />{preview && <ResourceNavigationProvider><Editor name="preview" calls={previewCalls} close={() => setPreview(false)} /><Links /></ResourceNavigationProvider>}</ResourceNavigationProvider>;
    }
    render(<MemoryRouter initialEntries={["/doc"]}><Workspace /></MemoryRouter>);
    await userEvent.click(screen.getByRole("link", { name: "Sidebar search" }));
    expect(previewCalls).toHaveBeenCalledOnce();
    expect(documentCalls).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm preview" }));
    expect(documentCalls).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Confirm document" }));
    expect(previewCalls).toHaveBeenCalledOnce();
    expect(documentCalls).toHaveBeenCalledOnce();
  });
});
