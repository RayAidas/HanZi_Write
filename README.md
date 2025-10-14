# WriteDemo - 汉字书写演示项目

这是一个基于 Cocos Creator 的汉字书写演示项目，集成了 Hanzi Writer 库，用于展示和练习汉字笔画书写。

## 项目特性

-   支持汉字笔画动画演示
-   支持汉字书写练习
-   基于 Cocos Creator 引擎开发
-   集成 Hanzi Writer 库

## 字库配置

### 下载字库数据

本项目需要使用 Hanzi Writer 的字库数据。请按照以下步骤配置：

1. 访问 [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) 仓库
2. 下载所需的汉字数据文件
3. 将下载的data文件夹放入 `assets/resources/` 目录下,并改名为hanzi-writer-data

### 字库目录结构

```
assets/
  └── resources/
      └── hanzi-writer-data/
          ├── 我.json
          ├── 你.json
          └── ... (其他汉字数据文件)
```

## 使用说明

1. 确保已安装 Cocos Creator
2. 下载并配置字库数据（见上方说明）
3. 使用 Cocos Creator 打开本项目
3.1 在编辑器的 WriteAdvanced 组件中勾选 Quiz Mode 可以启动手写练习模式
4. 运行场景 `assets/main.scene`

## 许可证

字库数据来自 [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) 项目，该数据基于 Arphic Public License 授权。

## 相关链接

-   [Hanzi Writer](https://chanind.github.io/hanzi-writer)
-   [Hanzi Writer Data](https://github.com/chanind/hanzi-writer-data)
