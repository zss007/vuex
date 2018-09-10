export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  if (version >= 2) {
    // 全局混入 beforeCreate 钩子函数
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   * 给 Vue 的实例注入一个 $store 的属性
   */

  function vuexInit () {
    const options = this.$options
    // 把 options.store 保存在所有组件的 this.$store 中
    if (options.store) {
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) { // 如果 $options 没有 store，则向其 parent 向上查找并赋值
      this.$store = options.parent.$store
    }
  }
}
