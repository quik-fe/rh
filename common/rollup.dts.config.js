const dts = require("rollup-plugin-dts").default;
const path = require("path");

const cwd_pth = (pth) => path.join(process.cwd(), pth);

// only pack dts files
module.exports = [
  {
    input: cwd_pth("./src/main.ts"),
    output: [{ file: cwd_pth("./dist/main.d.ts"), format: "es" }],
    plugins: [
      dts({
        // 开启的话就所有依赖的类型都打包到一起
        // respectExternal: true,
      }),
    ],
    external: [],
  },
];
