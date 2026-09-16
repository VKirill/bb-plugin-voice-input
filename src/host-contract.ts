// Полный контракт хоста: управление плюс голосовой контракт SDK.
// Импортируется только из host.ts — серверной части этот вход SDK недоступен.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_aiServicesHostContract } from "@get-bb/plugin-sdk/ai-services";
import { managementContract } from "./contract.js";

export const hostContract = defineRpcContract({
  ...managementContract,
  ...experimental_aiServicesHostContract,
});
