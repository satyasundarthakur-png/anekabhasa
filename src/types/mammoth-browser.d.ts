declare module "mammoth/mammoth.browser.js" {
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: any[] }>;
  };
  export default mammoth;
}
