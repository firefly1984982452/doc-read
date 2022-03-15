# 简介

<!-- > 上有天堂、下有书房 -->



```html
<style>
.line-clamp{
  width: 300px;
}
.line-clamp h2{
  text-align: center;
}
.line-clamp p{
  display: inline-block;
  text-align: left;
  overflow : hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.line-clamp em{
  display: block;
  text-align: center;
}
</style>

<div class="example line-clamp">
  <h2><p><em>单行居中，多行居左<em></p></h2>
  <h2><p>上呼吸道感染，咽喉痛无发热</p></h2>
  <h2><p>老人主诉头晕多日，饭后胸闷，结合体检情况，考虑为交感神经。</p></h2>
</div>
```