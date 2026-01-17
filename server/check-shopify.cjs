const fetch = require('node-fetch');
require('dotenv').config();

const shopifyProductId = '8544529907909';
const shopUrl = process.env.SHOPIFY_SHOP_URL;
const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

async function checkShopify() {
  const url = `https://${shopUrl}/admin/api/2024-01/products/${shopifyProductId}.json`;
  
  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });
  
  const data = await response.json();
  
  if (data.product) {
    console.log('Shopify Product Data:');
    console.log('  Title:', data.product.title);
    console.log('  Product Type:', data.product.product_type);
    console.log('  Tags:', data.product.tags);
    console.log('  Updated At:', data.product.updated_at);
  } else {
    console.log('Error:', data);
  }
}

checkShopify();
