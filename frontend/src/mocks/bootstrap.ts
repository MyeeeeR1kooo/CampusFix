import { installMock, mockSwitchOn } from "../api/mockBridge";

export async function startDevelopmentMock(): Promise<void> {
  if (import.meta.env.DEV && mockSwitchOn()) {
    const { createMockApi } = await import("./responder");
    installMock(createMockApi().responder);
  }
}
