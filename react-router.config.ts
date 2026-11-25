import type { Config } from "@react-router/dev/config";

export default {
  future: {
    // Root middleware: standalone-site canonical host redirect (www.cardbit.com → cardbit.com).
    v8_middleware: true,
  },
} satisfies Config;
