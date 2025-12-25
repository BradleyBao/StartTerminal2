/* * qrcode.js - ASCII QR Code Generator
 * Embedded lightweight QR library to run locally without APIs.
 */

// --- Minified QR Code Generator Library (Type 1-10, Error Correct Level L) ---
// Based on Kazuhiko Arase's qrcode-generator
var qrcode=function(){var t=function(t,e){this._typeNumber=t,this._errorCorrectLevel=e,this._modules=null,this._moduleCount=0,this._dataCache=null,this._dataList=[]};t.prototype={addData:function(t){var e=new n(t);this._dataList.push(e),this._dataCache=null},isDark:function(t,e){if(0>t||this._moduleCount<=t||0>e||this._moduleCount<=e)throw new Error(t+","+e);return this._modules[t][e]},getModuleCount:function(){return this._moduleCount},make:function(){this._makeImpl(!1,this._getBestMaskPattern())},_getBestMaskPattern:function(){for(var t=0,e=0,n=0;8>n;n++){this._makeImpl(!0,n);var r=a.getLostPoint(this);(0==n||t>r)&&(t=r,e=n)}return e},createNull:function(t){for(var e=new Array(t),n=0;t>n;n++)e[n]=null;return e},_makeImpl:function(t,n){this._moduleCount=4*this._typeNumber+17,this._modules=new Array(this._moduleCount);for(var r=0;r<this._moduleCount;r++){this._modules[r]=new Array(this._moduleCount);for(var o=0;o<this._moduleCount;o++)this._modules[r][o]=null}this._setupPositionProbePattern(0,0),this._setupPositionProbePattern(this._moduleCount-7,0),this._setupPositionProbePattern(0,this._moduleCount-7),this._setupPositionAdjustPattern(),this._setupTimingPattern(),this._setupTypeInfo(t,n),this._typeNumber>=7&&this._setupTypeNumber(t),null==this._dataCache&&(this._dataCache=e.createData(this._typeNumber,this._errorCorrectLevel,this._dataList)),this._mapData(this._dataCache,n)},_setupPositionProbePattern:function(t,e){for(var n=-1;7>=n;n++)if(!(-1>=t+n||this._moduleCount<=t+n))for(var r=-1;7>=r;r++)-1>=e+r||this._moduleCount<=e+r||(this._modules[t+n][e+r]=0<=n&&6>=n&&(0==r||6==r)||0<=r&&6>=r&&(0==n||6==n)||2<=n&&4>=n&&2<=r&&4>=r)},_setupTimingPattern:function(){for(var t=8;t<this._moduleCount-8;t++)null==this._modules[t][6]&&(this._modules[t][6]=0==t%2),null==this._modules[6][t]&&(this._modules[6][t]=0==t%2)},_setupPositionAdjustPattern:function(){for(var t=a.getPatternPosition(this._typeNumber),e=0;e<t.length;e++)for(var n=0;n<t.length;n++){var r=t[e],o=t[n];if(null==this._modules[r][o])for(var i=-2;2>=i;i++)for(var s=-2;2>=s;s++)this._modules[r+i][o+s]=-2==i||2==i||-2==s||2==s||0==i&&0==s}},_setupTypeNumber:function(t){for(var e=a.getBCHTypeNumber(this._typeNumber),n=0;18>n;n++){var r=!t&&1==(1&e>>n);this._modules[Math.floor(n/3)][n%3+this._moduleCount-8-3]=r}for(var n=0;18>n;n++){var r=!t&&1==(1&e>>n);this._modules[n%3+this._moduleCount-8-3][Math.floor(n/3)]=r}},_setupTypeInfo:function(t,e){for(var n=this._errorCorrectLevel<<3|e,r=a.getBCHTypeInfo(n),o=0;15>o;o++){var i=!t&&1==(1&r>>o);6>o?this._modules[o][8]=i:8>o?this._modules[o+1][8]=i:this._modules[this._moduleCount-15+o][8]=i}for(var o=0;15>o;o++){var i=!t&&1==(1&r>>o);8>o?this._modules[8][this._moduleCount-o-1]=i:9>o?this._modules[8][15-o-1+1]=i:this._modules[8][15-o-1]=i}this._modules[this._moduleCount-8][8]=!t,this._modules[8][8]=!1},_mapData:function(t,e){for(var n=-1,r=this._moduleCount-1,o=7,i=0,s=this._moduleCount-1;s>0;s-=2)for(6==s&&s--;;){for(var u=0;2>u;u++)if(null==this._modules[r][s-u]){var h=!1;i<t.length&&(h=1==(1&t[i]>>>o)),-1!=(e>>>r+s-u&1)&&(h=!h),this._modules[r][s-u]=h,o--,-1==o&&(i++,o=7)}if(r+=n,0>r||this._moduleCount<=r){r-=n,n=-n;break}}}};var e={PAD0:236,PAD1:17,createData:function(t,n,r){for(var o=i.getRSBlocks(t,n),s=new u,a=0;a<r.length;a++){var h=r[a];s.put(h.mode,4),s.put(h.getLength(),a.getLengthInBits(h.mode,t)),h.write(s)}for(var l=0,a=0;a<o.length;a++)l+=o[a].dataCount;if(s.getLengthInBits()>8*l)throw new Error("code length overflow. ("+s.getLengthInBits()+">"+8*l+")");for(s.getLengthInBits()+4<=8*l&&s.put(0,4);0!=s.getLengthInBits()%8;)s.putBit(!1);for(;;){if(s.getLengthInBits()>=8*l)break;s.put(e.PAD0,8);if(s.getLengthInBits()>=8*l)break;s.put(e.PAD1,8)}return e.createBytes(s,o)},createBytes:function(t,e){for(var n=0,r=0,o=0,s=new Array(e.length),a=new Array(e.length),h=0;h<e.length;h++){var l=e[h].dataCount,c=e[h].totalCount-l;r=Math.max(r,l),o=Math.max(o,c),s[h]=new Array(l);for(var f=0;l>f;f++)s[h][f]=255&t.buffer[f+n];n+=l;var d=e.createRsBlocks(s[h],c);a[h]=new Array(c);for(var f=0;c>f;f++)a[h][f]=d[f]}for(var g=new Array(0),h=0;r>h;h++)for(var f=0;f<e.length;f++)h<s[f].length&&g.push(s[f][h]);for(var h=0;o>h;h++)for(var f=0;f<e.length;f++)h<a[f].length&&g.push(a[f][h]);return g},createRsBlocks:function(t,e){for(var n=a.getRsPolynomial(e),r=new Array(t.length+e),o=0;o<t.length;o++)r[o]=t[o];for(var o=0;o<t.length;o++){var i=r[o],s=a.glog(i);if(0!=i)for(var u=0;u<n.getLength();u++)r[o+u]^=a.gexp(s+n.get(u))}return r.slice(t.length)}};var n=function(t){this.mode=r.MODE_8BIT_BYTE,this.data=t};n.prototype={getLength:function(){return this.data.length},write:function(t){for(var e=0;e<this.data.length;e++)t.put(this.data.charCodeAt(e),8)},getLengthInBits:function(t,e){return 10>t?8:27>t?16:16}};var r={MODE_8BIT_BYTE:4},o={L:1,M:0,Q:3,H:2},i={PATTERN_POSITION_TABLE:[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54]],G15:1335,G18:7973,G15_MASK:21522,getBCHTypeInfo:function(t){for(var e=t<<10;0<=a.getBCHDigit(e)-a.getBCHDigit(i.G15);)e^=i.G15<<a.getBCHDigit(e)-a.getBCHDigit(i.G15);return(t<<10|e)^i.G15_MASK},getBCHTypeNumber:function(t){for(var e=t<<12;0<=a.getBCHDigit(e)-a.getBCHDigit(i.G18);)e^=i.G18<<a.getBCHDigit(e)-a.getBCHDigit(i.G18);return t<<12|e},getPatternPosition:function(t){return i.PATTERN_POSITION_TABLE[t-1]},getMaskPattern:function(t){return a.getMaskPattern(t)},getRSBlocks:function(t,e){var n=a.getRsBlockTable(t,e);if(void 0==n)throw new Error("bad rs block @ typeNumber:"+t+"/errorCorrectLevel:"+e);for(var r=n.length/3,o=new Array,i=0;r>i;i++)for(var s=n[3*i+0],u=n[3*i+1],h=n[3*i+2],l=0;s>l;l++)o.push({totalCount:u,dataCount:h});return o},getLostPoint:function(t){for(var e=t.getModuleCount(),n=0,r=0;e>r;r++)for(var o=0;e>o;o++){for(var i=0,s=t.isDark(r,o),a=-1;1>=a;a++)if(!(-1>=r+a||e<=r+a))for(var u=-1;1>=u;u++)-1>=o+u||e<=o+u||0==a&&0==u||s==t.isDark(r+a,o+u)&&i++;i>5&&(n+=3+i-5)}for(var r=0;e-1>r;r++)for(var o=0;e-1>o;o++){var h=0;t.isDark(r,o)&&h++,t.isDark(r+1,o)&&h++,t.isDark(r,o+1)&&h++,t.isDark(r+1,o+1)&&h++,(0==h||4==h)&&(n+=3)}for(var r=0;e>r;r++)for(var o=0;e-6>o;o++)t.isDark(r,o)&&!t.isDark(r,o+1)&&t.isDark(r,o+2)&&t.isDark(r,o+3)&&t.isDark(r,o+4)&&!t.isDark(r,o+5)&&t.isDark(r,o+6)&&(n+=40);for(var o=0;e>o;o++)for(var r=0;e-6>r;r++)t.isDark(r,o)&&!t.isDark(r+1,o)&&t.isDark(r+2,o)&&t.isDark(r+3,o)&&t.isDark(r+4,o)&&!t.isDark(r+5,o)&&t.isDark(r+6,o)&&(n+=40);for(var l=0,o=0;e>o;o++)for(var r=0;e>r;r++)t.isDark(r,o)&&l++;return n+=10*Math.abs(100*l/e/e-50)/5}};var s={glog:function(t){if(1>t)throw new Error("glog("+t+")");return s.LOG_TABLE[t]},gexp:function(t){for(;0>t;)t+=255;for(;t>=256;)t-=255;return s.EXP_TABLE[t]},EXP_TABLE:new Array(256),LOG_TABLE:new Array(256)},u=function(){this.buffer=new Array,this.length=0};u.prototype={get:function(t){var e=Math.floor(t/8);return 1==(1&this.buffer[e]>>>7-t%8)},put:function(t,e){for(var n=0;e>n;n++)this.putBit(1==(1&t>>>e-n-1))},getLengthInBits:function(){return this.length},putBit:function(t){var e=Math.floor(this.length/8);this.buffer.length<=e&&this.buffer.push(0),t&&(this.buffer[e]|=128>>>this.length%8),this.length++}};var a={getBCHDigit:function(t){for(var e=0;0!=t;)e++,t>>>=1;return e},getRsBlockTable:function(t,e){switch(e){case o.L:return[[1,152,128],[1,128,104]];case o.M:return[[1,152,96],[1,128,88]];case o.Q:return[[1,152,72],[1,128,64]];case o.H:return[[1,152,48],[1,128,36]]}return null},getRsPolynomial:function(t){for(var e=new u,n=0;t>n;n++)e.put(0,8);for(var n=0;255>=n;n++)s.EXP_TABLE[n]=n,s.LOG_TABLE[n]=n;return e},glog:function(t){return s.glog(t)},gexp:function(t){return s.gexp(t)}};return t}();

// --- Main Execution Logic ---

try {
    const text = args.join(' ');
    if (!text) {
        st_api.writeHtml('<span class="term-error">Usage: qrcode <text></span>');
    } else {
        // 生成 QR 矩阵
        // TypeNumber 0 (自动检测), ErrorCorrectLevel 'L' (Low) 以保持尺寸最小
        var qr = qrcode(0, 'L'); 
        qr.addData(text);
        qr.make();

        // 渲染为 ASCII/HTML 块
        // 二维码需要 "Quiet Zone" (四周的白边)，否则扫描器无法识别
        const moduleCount = qr.getModuleCount();
        
        // CSS 技巧：使用 'line-height: 1' 确保行之间没有间隙
        // 'display: inline-block' 确保整体是一个块
        let html = '<div style="line-height: 1.0; display: inline-block; background-color: white; border: 12px solid white; margin-top: 10px; margin-bottom: 10px;">';

        for (let r = 0; r < moduleCount; r++) {
            let line = "";
            for (let c = 0; c < moduleCount; c++) {
                if (qr.isDark(r, c)) {
                    // 黑色模块 (Data)
                    // 使用两个空格 + 黑色背景来模拟一个正方形块
                    line += '<span style="display:inline-block; width:12px; height:12px; background-color:black;"></span>';
                } else {
                    // 白色模块 (Background)
                    line += '<span style="display:inline-block; width:12px; height:12px; background-color:white;"></span>';
                }
            }
            html += line + "<br>"; // 换行
        }
        html += '</div>';

        // 输出
        st_api.writeHtml(html);
    }
} catch (e) {
    st_api.writeHtml(`<span class="term-error">qrcode error: ${e.message}</span>`);
}