// Match bundler extension/JSON resolution while executing the actual route code in Node.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".json")) {
    return { ...await nextResolve(specifier, context), importAttributes: { type: "json" } };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
