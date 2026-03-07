import axios from 'axios';

const client = axios.create({ baseURL: 'https://odin-backend-production-3220.up.railway.app/api' });

export default client;